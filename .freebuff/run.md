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

## 3. Files modified for docker compose

| File                     | Change                                            |
|--------------------------|---------------------------------------------------|
| `docker-compose.yml`     | New — full stack definition                       |
| `frontend/.dockerignore` | New — excludes node_modules (443MB) from context  |
| `backend/.dockerignore`  | New — excludes .venv, __pycache__ from context    |
| `frontend/Dockerfile`    | Changed `npm install` → `--legacy-peer-deps`      |
| `backend/requirements.txt` | Removed unused `emergentintegrations==0.2.0`     |
