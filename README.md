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

## Operational notes

- MongoDB indexes are created idempotently during startup. Review index changes as part of deployments.
- Published race results should be treated as immutable publication events; corrections should create a new publication event/snapshot.
- The Official Notice Board is a separate public club destination at `/club/:slug/notice-board`.
- Audit-log reads are Webmaster-only at the API boundary; ordinary users do not receive audit records in general responses.
