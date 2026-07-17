# Allay backend

Independent Phoenix API and Minecraft runtime orchestrator.

## Development

Start the local PostgreSQL dependency, then run the backend:

```bash
docker compose up -d
cp .env.example .env
mix setup
mix phx.server
```

The Compose file runs only PostgreSQL 17. Stop it with `docker compose down`; its named volume preserves the database data.

The backend listens on `http://localhost:4000` and exposes:

- `/api/*` for the REST API;
- `/socket` for Phoenix Channels;
- `/health` for liveness checks.

It does not build or serve the frontend. Set `FRONTEND_ORIGIN` to the exact browser origin allowed by CORS and Channels.

## Verification

```bash
mix check
```

## Container image

```bash
docker build -t allay-backend .
```

The image requires `DATABASE_URL`, `SECRET_KEY_BASE`, and `FRONTEND_ORIGIN` at runtime. It runs database migrations before starting the release.
