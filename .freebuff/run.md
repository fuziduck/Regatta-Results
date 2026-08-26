# Run doc — Sailing Club Racing App (frontend preview)

The project is a FastAPI + MongoDB backend (`backend/`, port 8000) and a React
SPA (`frontend/`, port 3000). The Preview tab serves the **docker compose
frontend** — the full stack runs via `docker compose -f docker-compose.dev.yml up`
(the default `docker-compose.yml` is the PRODUCTION stack and must never be
used for local preview work).

## 1. Quick start (docker compose, development)

```bash
cd /Users/lukehopper/Documents/regatta-results
cp .env.example .env        # fill in dev values (JWT_SECRET, WEBMASTER_PASSCODE)
docker compose -f docker-compose.dev.yml up --build -d
```

This builds and starts all three services:

| Service   | Port | Notes                                    |
|-----------|------|------------------------------------------|
| frontend  | 3000 | CRA dev server (webpack hot-reload)      |
| backend   | 8000 | FastAPI + uvicorn (auto-reload on edit)  |
| mongodb   | —    | mongo:7, named volume `mongo-data`       |

First run takes ~3-5 min (frontend `npm install`). Subsequent runs are
instant (cached layers). Verify with:

```bash
docker compose ps          # all healthy?
curl -s http://127.0.0.1:8000/api/   # API reachable?
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/  # frontend?
```

### Why compose instead of manual docker run

The old setup bind-mounted `/tmp/regatta/backend` → `/app` — fragile because
macOS wipes `/tmp` on reboot and various tooling recreates the dirs empty.
`docker compose` eliminates this: the backend mount points at `./backend`
(the workspace), so data survives reboots. It also adds:

- **Healthchecks**: mongo → backend → frontend dependency chain (backend
  won't start until mongo is healthy).
- **Named volume**: mongo data persists across `docker compose down/up`.
- **`--reload`**: edits to `server.py` are reflected immediately — no rebuild.
- **Consistent env**: all vars in one YAML file, no `docker run -e` flags.

### Key gotchas

- **REACT_APP_BACKEND_URL**: `api.js` has **no default** — the frontend
  container must have this env set, and it must be a host-accessible URL
  (`http://localhost:8000`, NOT `http://backend:8000`) because the JS
  bundle runs in the browser, not inside the container. It must be
  **`localhost`** (not `127.0.0.1`): authentication uses a SameSite=Lax
  HttpOnly session cookie, so the browser page (`http://localhost:3000`)
  and the API must share the same site. Browse the app at
  `http://localhost:3000`, not `http://127.0.0.1:3000`.
- **Port conflicts**: stop any legacy containers first if names clash:
  `docker stop regatta-backend regatta-frontend regatta-mongodb 2>/dev/null`
- **Preview registration PID**: the Freebuff preview must be registered with a
  HOST-visible pid. A container's `docker inspect .State.Pid` is inside the
  Docker VM and is rejected. Use the host process listening on the port
  instead (`lsof -nP -iTCP:3000 -sTCP:LISTEN` → `com.docker`).
- **After a restart**: the compose stack dies with Docker Desktop; relaunch
  with `open -a Docker`, wait for the socket, then
  `docker compose -f docker-compose.dev.yml up -d`. Remove any stale
  launchd preview job (`launchctl remove com.codebuff.pv30eb`) before
  starting a fresh preview.
- **Don't run the static preview server** (`python3 -m http.server 3000`)
  while the compose stack is up — it binds 127.0.0.1:3000 first and shadows
  the frontend container.
- **Mongo data volume**: the real club data lives in the EXTERNAL volume
  `regatta_mongodb_data` (from the original `docker run` mongo container),
  referenced in compose as `mongo-data: {external: true, name: regatta_mongodb_data}`.
  Do NOT swap this for a fresh volume — a fresh mongo would only contain the
  starter seed (no races/results). Recover with `docker run -v regatta_mongodb_data:/data/db mongo:7`.
- **Backend mount**: `./backend:/app` works because pip installs to system
  site-packages (outside /app), so the mount only shadows source code, not
  dependencies. The workspace `.venv` is inert inside the container.
- **Frontend code changes**: require `docker compose up --build` to rebuild
  the image (CRA bundles at image build time). Backend changes are live
  immediately via `--reload`.

## 2. Reproduce the build artifacts (without Docker)

If you need a standalone production build (e.g. for the preview tab's
static server):

```bash
cd frontend
npm install --legacy-peer-deps --no-audit --no-fund
REACT_APP_BACKEND_URL=<backend-origin> npm run build
# e.g. REACT_APP_BACKEND_URL=https://fleet-timer-1.preview.emergentagent.com
```

Notes:
- `--legacy-peer-deps` is required (react 19 + CRA 5 peer conflict).
- `ajv@^8` is declared in `package.json` — schema-utils@4 needs ajv 8.
- Output lands in `frontend/build/` (gitignored).

## 2b. Preview when port 3000 is already taken (static build + /api proxy)

When another thread holds port 3000 (docker stack), start an independent
preview of the **current frontend** on a free port. The app needs the local
backend (127.0.0.1:8000) for data, but the backend's CORS allowlist only
covers port 3000 — so the preview server also proxies `/api/*` to the
backend (same-origin, no CORS needed):

```bash
# 1. Rebuild the app pointed at the preview port (bakes the API origin)
cd frontend
REACT_APP_BACKEND_URL=http://127.0.0.1:3100 CI=false npm run build

# 2. Serve a COPY of the build from /tmp with the proxy helper
cp -R build /tmp/preview-build-30eb
cp .freebuff/serve_preview.py /tmp/serve_preview_30eb.py
launchctl submit -l com.codebuff.pv30eb -- /bin/sh -c \
  "/usr/bin/python3 /tmp/serve_preview_30eb.py > /tmp/preview-30eb-run.log 2>&1"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/
```

**Important**: `serve_preview.py` has hardcoded `ROOT = Path("/tmp/preview-build-30eb")`
and `PORT = 3100`. It does NOT accept `--root` or `--port` CLI flags. You
MUST copy the build to `/tmp/preview-build-30eb` for it to work. If you
need a different port or path, edit the constants at the top of the script
before copying it to `/tmp`.

`serve_preview.py` serves the SPA with a fallback to `index.html` for deep
links and proxies `/api/*` to `http://127.0.0.1:8000`. The webmaster account
(username `webmaster`) is bootstrapped once from the `WEBMASTER_PASSCODE` env
(see `.env`); the legacy `WEBMASTER_PIN` / shared-PIN login no longer exists.

### Webmaster two-factor authentication (TOTP + emailed fallback)

The webmaster login is two-step: after the passcode verifies, the server
answers `{requires_2fa}` and the webmaster must enter a 6-digit code from
their authenticator app (TOTP), or an emailed code sent to the fallback
email. Enrollment lives under **Webmaster console → Security**: scan the QR
code, verify one code to enable, and set the fallback email. Disabling 2FA
requires the current passcode plus a valid verification code.

**Forgot the webmaster passcode?** Use the "Forgot your passcode?" link on
the login page (shown for the webmaster too). The forgot-password page is a
single unified form — club officials pick their club and enter their club
email; the webmaster just enters the backup email stored on the account (the
backend resolves the webmaster regardless of the selected club, and the
reset link is emailed to that backup address — the same one used for 2FA
fallback codes). The backup email survives 2FA being disabled, so the reset
path never depends on 2FA being on.

Secrets at rest (all on the webmaster user doc in Mongo, never exposed by
`GET /admin/users` or backups):

- `totp_secret_enc` — TOTP secret, Fernet-encrypted with `JWT_SECRET`
- `totp_enabled`, `totp_enrolled_at`
- `email` — fallback email address (also used for emailed sign-in codes)
- `email_otp_hash` / `email_otp_expires` — one-time emailed code

**Emergency recovery (lost passcode, lost authenticator, or `JWT_SECRET`
changed so the TOTP secret no longer decrypts):** disable 2FA directly in
Mongo, then sign in with just the passcode and re-enroll:

```bash
docker compose -f docker-compose.dev.yml exec mongodb mongosh \
  --quiet sailscore --eval 'db.users.updateOne(
    {username: "webmaster"},
    {$unset: {totp_secret_enc: "", totp_enabled: "", totp_enrolled_at: "",
              email: "", email_otp_hash: "", email_otp_expires: ""}})'
```

If the passcode itself is lost, bootstrap a new one by re-running the
webmaster seed with a fresh `WEBMASTER_PASSCODE` (the seeder upserts the
webmaster account).

### Security model notes (backups & restores)

- Backups (`GET /admin/backup`) and restores require the webmaster session;
  2FA is enforced at login, not per-request, so a live webmaster session can
  still back up or restore without re-authenticating. Revoke a stolen
  session by rotating `JWT_SECRET` or deleting the session in Mongo.
- Backup export already strips secrets (passcode hashes, TOTP secret, emails)
  via `BACKUP_SECRET_KEYS`, so a downloaded backup cannot leak credentials.

Gotcha (2026-08-22): running a bare `npm run build` **without**
`REACT_APP_BACKEND_URL` bakes `undefined/api` into the bundle — every page
crashes with `o.map is not a function` (the API base resolves to a URL that
falls back to index.html). Always set the env var when building; then serve
a fresh copy to `/tmp/preview-build-30eb` and clear the browser cache (the
static server serves the SPA document from cache, so deep links can keep
running an older bundle hash until cache-busted).

### Why serve from /tmp via launchd (gotchas discovered 2026-08-21)

- `nohup ... &` from the command runner is reaped when the call returns;
  the reliable detach is `launchctl submit` + `launchctl remove` when done.
- launchd processes **cannot read the workspace** (macOS provenance
  restrictions): files under the project and even `frontend/build` 404 with
  "Operation not permitted". Serving a copy from `/tmp` works.
- `python3 -m http.server` **fails under launchd**: `--directory`'s default
  is computed via `os.getcwd()` at startup, which launchd denies. Use the
  helper script (explicit absolute ROOT, never getcwd).
- Log files created by the app's sandbox (e.g. the suggested `.freebuff/*.log`)
  are unwritable by launchd-spawned processes (`com.apple.provenance` xattr).
  Redirect the job's log to `/tmp` instead.

## 3. Files modified for docker compose

| File                     | Change                                            |
|--------------------------|---------------------------------------------------|
| `docker-compose.yml`     | PRODUCTION stack (default): mongo auth, no exposed backend, nginx frontend |
| `docker-compose.dev.yml` | DEVELOPMENT stack: dev servers, ports 3000/8000, real data volume |
| `frontend/Dockerfile.prod`, `frontend/nginx.conf` | Production frontend image |
| `frontend/.dockerignore` | Excludes node_modules (443MB) from context        |
| `backend/.dockerignore`  | Excludes .venv, __pycache__ from context          |
| `frontend/Dockerfile`    | `npm install` → `--legacy-peer-deps`              |
| `backend/requirements.txt` | Removed unused `emergentintegrations==0.2.0`     |
