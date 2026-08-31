# SailScore

Club sailing race-results and Official Notice Board application.

## Stack

- **Frontend:** React, Tailwind, shadcn/ui, React Router, TanStack React Query.
- **Backend:** FastAPI, Motor/PyMongo, MongoDB.
- **Authentication:** HttpOnly JWT session cookies, individual club users, Webmaster role, server-side club scoping.

## Local development

1. Start MongoDB and the development services:

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Install frontend dependencies with the pinned package manager:

   ```bash
   cd frontend
   yarn install --frozen-lockfile
   ```

3. Start the frontend:

   ```bash
   yarn start
   ```

The development frontend is normally available at `http://localhost:3000` and proxies API requests to the backend at `http://localhost:8000`.

## Backend

The backend reads `backend/.env`. Required development settings include:

```dotenv
MONGO_URL=mongodb://localhost:27017
DB_NAME=sailscore
JWT_SECRET=use-a-random-development-secret
```

Production must additionally use a strong `JWT_SECRET`, restricted `CORS_ORIGINS`, `WEBMASTER_PASSCODE`, authenticated MongoDB, and `APP_BASE_URL`. SMTP settings are only required for email features:

```dotenv
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
APP_BASE_URL=https://results.example.org
PUBLIC_APP_BASE_URL=https://results.example.org
PUBLIC_API_BASE_URL=https://results.example.org/api
```

Never commit `.env`, credentials, tokens, or generated runtime files.

## Importing historic results

`backend/import_results.py` loads historic completed results straight into the
database as normal published races/series, so standings are computed by the
scoring engine (no manual calculation). It is JSON-driven and idempotent:

```bash
# copy the manifest into the backend container, then run it
# (dev container: regatta-backend · production: sailscore-backend)
docker cp manifest.json regatta-backend:/tmp/manifest.json
docker exec regatta-backend python /app/import_results.py /tmp/manifest.json
```

The manifest describes one club/class/year and any number of series — boats
(upserted by sail number), each series' discards / overall flag / order, and
per-race results (position, a code like `DNF`/`RET`, or `["RDG", points]`;
boats missing from a race score DNC). See the docstring in
`backend/import_results.py` for the schema. Re-running the same manifest is a
clean re-import: the named series and their races are replaced, orphaned
races left behind by a previous generation of series are purged for that
class/year, and nothing outside them (other series, other years, other
clubs) is touched.

A ready-to-run example for Medway Yacht Club's 2025 Sonata season ships at
`backend/manifests/sonata-medway-2025.json` (all five series, 21 races,
verified against the Sailwave exports):

```bash
docker cp backend/manifests/sonata-medway-2025.json regatta-backend:/tmp/manifest.json
```

Note on club backups: a club-scoped restore replaces the whole club —
classes, boats, series and races (series/races are deleted via the backup's
class ids, so a re-restore cannot leave stale duplicate series or races
behind). Individual club logins are replaced too; use an encrypted backup
(generate a passphrase) if you want sign-in passcodes carried across.

## Tests and quality checks

```bash
cd backend
.venv/bin/python -m pytest tests/ -q
.venv/bin/python -m black --check server.py tests
.venv/bin/python -m flake8 server.py tests

cd ../frontend
CI=true yarn test --watchAll=false --runInBand
yarn build
```

## Production deployment

Production runs on an Ubuntu host with Caddy terminating TLS in front of the
Docker Compose application stack (see `deploy/README.md` for the full
topology and Caddy install). A full GitHub → production deployment is done
with a single command:

```bash
cd /opt/regatta-results && ./deploy.sh
```

`deploy.sh` safely:

- verifies it runs from `/opt/regatta-results`, that Git is available, that the
  branch is `main`, and that the working tree has no uncommitted changes
  (it stops rather than ever discarding local work);
- fetches `origin`, stops early if production is already up to date, otherwise
  lists the commits to deploy and pulls with `git pull --ff-only`;
- validates `docker compose config` — including that the frontend binds
  `127.0.0.1:8080:80` (loopback-only) and never binds host port 80 — then
  `docker compose build` and `docker compose up -d`;
- checks MongoDB / backend / frontend health and requires HTTP 200 from both
  the internal frontend (`http://127.0.0.1:8080/`) and the public site
  (`https://www.sailscore.co.uk/`);
- never runs `docker compose down -v`, never deletes the MongoDB volume, and
  never touches Caddy, the domain, the frontend port, or `.env`.

It is `chmod +x` already; run it from `/opt/regatta-results` (not elsewhere).

## Operational notes

- MongoDB indexes are created idempotently during startup. Review index changes as part of deployments.
- Published race results should be treated as immutable publication events; corrections should create a new publication event/snapshot.
- The Official Notice Board is a separate public club destination at `/club/:slug/notice-board`.
- Audit-log reads are Webmaster-only at the API boundary; ordinary users do not receive audit records in general responses.
