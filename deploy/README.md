# SailScore production deployment — Ubuntu 26.04 LTS NUC (Intel)

This documents the **production** topology: a host-installed Caddy reverse
proxy in front of a Docker Compose application stack. Nothing in the Docker
stack is exposed to the Internet — Caddy is the single entry point and
terminates TLS.

```
Internet
   │
   │ HTTPS :443
   ▼
Caddy (systemd service, installed on the Ubuntu host)
   │  reverse_proxy 127.0.0.1:8080
   ▼
Docker frontend nginx  (host bind 127.0.0.1:8080 ONLY — loopback)
   │  /api → proxy_pass http://backend:8000
   ▼
FastAPI backend :8000  (internal Docker network, NO host port)
   ▼
MongoDB :27017         (internal Docker network, NO host port)
```

Ports **3000, 8000 and 27017 are never exposed to the Internet**. Host port
8080 is loopback-only, reachable solely by Caddy on the host (Caddy itself
owns public ports 80 and 443).

---

## 1. Deploy the Docker application stack

```bash
cd /opt/sailscore            # wherever you cloned the repo
cp .env.example .env         # fill in REAL values (JWT_SECRET, MONGO creds,
                             # WEBMASTER_PASSCODE, CORS_ORIGINS, APP_BASE_URL, …)
docker compose up -d --build
docker compose ps            # all three services healthy
```

The default `docker-compose.yml` is the production stack:

| Service  | Published ports          | Notes                                              |
|----------|--------------------------|----------------------------------------------------|
| frontend | `127.0.0.1:8080:80`      | nginx SPA + `/api` proxy; loopback only            |
| backend  | none                     | internal Docker network only                       |
| mongodb  | none                     | internal network, credentials required, auth on    |

Environment variables that matter here:

- `CORS_ORIGINS` — must list the real origin, e.g. `https://results.myclub.org`
  (production refuses `*`).
- `TRUSTED_PROXY_IPS` — the trusted reverse proxies whose `X-Forwarded-For`
  header is honoured. Defaults to the pinned internal Docker network
  `172.28.0.0/16` (matches the network defined in `docker-compose.yml`). The
  backend only ever honours XFF from a peer inside this range, so a forged
  header from anywhere else is ignored.
- `APP_BASE_URL` — must be `https://results.myclub.org` (password-reset links).

---

## 2. Install Caddy on the Ubuntu host (NOT in Docker)

Caddy runs as a normal systemd service directly on the Ubuntu host.

```bash
# 2a. Add the official Caddy apt repository
sudo apt-get update
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list

# 2b. Install Caddy
sudo apt-get update
sudo apt-get install -y caddy

# 2c. Install the SailScore Caddyfile (edit the domain first!)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile    # replace results.example.com with the real domain
```

The packaged `caddy.service` systemd unit is installed automatically. Make
sure ports 80 and 443 are free (nothing else may bind them) and the firewall
allows them:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 8000/tcp   # belt-and-braces: these must never be public
sudo ufw deny 27017/tcp
sudo ufw deny 3000/tcp
```

---

## 3. Enable, start, validate, reload, status, logs

```bash
# Start now and enable at boot
sudo systemctl enable --now caddy

# Validate the Caddyfile configuration
sudo caddy validate --config /etc/caddy/Caddyfile

# Reload the configuration (after any Caddyfile edit) — zero downtime
sudo systemctl reload caddy

# Check status
sudo systemctl status caddy

# Tail logs
sudo journalctl -u caddy -f -n 100

# Or the Caddy access/error log file (JSON)
tail -f /var/log/caddy/access.log
```

---

## 4. Verify the full production deployment

```bash
# The app answers through Caddy with HTTPS
curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://results.myclub.org/

# The landing page is the React SPA
curl -sS https://results.myclub.org/ | grep -o '<title>[^<]*</title>'

# The API answers through the proxy path
curl -sS https://results.myclub.org/api/clubs | head -c 200; echo

# HTTP redirects to HTTPS
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://results.myclub.org/

# TLS certificate is valid for the domain
echo | openssl s_client -servername results.myclub.org -connect results.myclub.org:443 2>/dev/null | grep 'Verify return code'

# Backend port is NOT reachable from outside the host
curl -sS --max-time 3 http://<server-ip>:8000/ && echo "LEAK (bad)" || echo "8000 closed (good)"

# MongoDB port is NOT reachable from outside the host
nc -zv -w 3 <server-ip> 27017 || echo "27017 closed (good)"
```

Expected: the browser at `https://results.myclub.org` shows the SailScore
landing page; all API calls go through the same origin (`/api/...`), proxied
Caddy → nginx → backend; the session cookie is `Secure` + `HttpOnly` +
`SameSite=Lax`.

---

## 5. Trusted client IP model (how this stays secure)

1. A client sends a request to Caddy. If the client forges an
   `X-Forwarded-For` header, Caddy **overwrites** it with the real client IP
   (`header_up X-Forwarded-For {remote_host}`) before forwarding to nginx.
2. nginx forwards to the backend over the internal Docker network. The
   backend sees the request's direct socket peer — the nginx container, whose
   address is inside the pinned `172.28.0.0/16` internal network.
3. The backend only reads `X-Forwarded-For` when the direct peer is inside
   `TRUSTED_PROXY_IPS` (default `172.28.0.0/16`). For every other peer —
   e.g. an attacker hitting the API directly, or a forged header from an
   untrusted source — the **socket peer** is used as the client IP and the
   header is ignored.

Consequences:

- A direct request with `X-Forwarded-For: 1.2.3.4` from an untrusted peer
  cannot spoof the IP used for login throttling or audit logging — the socket
  peer is recorded instead.
- Brute-force throttling and account lockout are keyed on the true client IP
  (the first XFF entry, only ever read from the trusted proxy chain), so a
  distributed/spoofed-header attack cannot rotate the throttle bucket.
- The audit log records the true client IP — never attacker-supplied data.

---

## 6. Security review checklist

- [ ] `docker-compose.yml` used (NOT `docker-compose.dev.yml` — dev exposes
      3000/8000 and disables mongo auth).
- [ ] Frontend bound to `127.0.0.1:8080` only (container port 80);
      backend/mongo have no host ports.
- [ ] `CORS_ORIGINS` = the real `https://` origin (never `*`).
- [ ] `JWT_SECRET` ≥ 32 random chars, `MONGO_*` credentials strong, all in
      gitignored `.env` (never in the repo or compose file).
- [ ] `TRUSTED_PROXY_IPS` matches the internal network (default already set).
- [ ] Caddy runs as the packaged systemd service, `sudo systemctl is-enabled caddy`
      prints `enabled`.
- [ ] `sudo caddy validate --config /etc/caddy/Caddyfile` passes.
- [ ] `ufw` denies 8000/27017/3000 from outside; allows 80/443.
