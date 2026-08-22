# Run doc — Sailing Club Racing App (frontend preview)

The project is a FastAPI + MongoDB backend (`backend/`, port 8000) and a React
SPA (`frontend/`, port 3000). The Preview tab serves the **docker compose
frontend** — the full stack runs via `docker compose up`.

## 1. Quick start (docker compose)

```bash
cd /Users/lukehopper/Documents/regatta-results
docker compose up --build -d
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
  (`http://127.0.0.1:8000`, NOT `http://backend:8000`) because the JS
  bundle runs in the browser, not inside the container.
- **Port conflicts**: stop any legacy containers first if names clash:
  `docker stop regatta-backend regatta-frontend regatta-mongodb 2>/dev/null`
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

`serve_preview.py` serves the SPA with a fallback to `index.html` for deep
links and proxies `/api/*` to `http://127.0.0.1:8000`. Webmaster PIN on the
compose backend defaults to `9999` unless the container env sets
`WEBMASTER_PIN`.

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
| `docker-compose.yml`     | New — full stack definition                       |
| `frontend/.dockerignore` | New — excludes node_modules (443MB) from context  |
| `backend/.dockerignore`  | New — excludes .venv, __pycache__ from context    |
| `frontend/Dockerfile`    | Changed `npm install` → `--legacy-peer-deps`      |
| `backend/requirements.txt` | Removed unused `emergentintegrations==0.2.0`     |
