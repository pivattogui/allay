# Allay

Self-hosted Minecraft server management platform. The backend manages local Minecraft processes and files; the frontend is an independently built web client.

```text
Browser ──► React frontend ──► Phoenix API ──► PostgreSQL
                 │                 │
                 └── Channels ─────┴──► Java server processes
```

The backend and frontend have separate configuration, build artifacts, and deployment lifecycles. This repository intentionally does not prescribe deployment orchestration.

## Projects

| Path | Stack | Development port | Responsibility |
|---|---|---:|---|
| `backend/` | Elixir 1.18, Phoenix 1.8, Ecto, Oban | 4000 | REST API, Channels, persistence, jobs, and Minecraft runtime orchestration |
| `frontend/` | React 19, Vite, TanStack Query, Zustand | 5173 | Browser application |

## Local development

### Requirements

- Erlang/OTP 27 and Elixir 1.18
- Node.js 22 and pnpm 10
- PostgreSQL 17
- Java 21 and/or 25 for running Minecraft locally

Runtime versions are owned by each project in `backend/.tool-versions` and `frontend/.tool-versions`. The repository root does not define a shared toolchain.

Start the development PostgreSQL instance from the backend directory. The Compose file owns only this local dependency; it does not run the backend or frontend:

```bash
cd backend
docker compose up -d
```

The backend development default expects `ecto://allay:allay@localhost:5432/allay_dev`; override it in `backend/.env` when your local database differs.

Run the backend:

```bash
cd backend
cp .env.example .env
mix setup
mix phx.server
```

Run the frontend in another terminal:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

The frontend opens at `http://localhost:5173`. Without a frontend `.env`, Vite proxies `/api` and `/socket` to `http://localhost:4000`. To call another backend directly, copy `frontend/.env.example` to `frontend/.env` and set `VITE_BACKEND_URL`.

## Independent builds

Build the backend image from its project directory:

```bash
cd backend
docker build -t allay-backend .
```

The image contains only the Phoenix release and Java runtimes. It requires `DATABASE_URL`, `SECRET_KEY_BASE`, and `FRONTEND_ORIGIN` at runtime.

Build the frontend static artifact:

```bash
cd frontend
VITE_BACKEND_URL=https://api.allay.example pnpm build
```

Publish `frontend/dist/` using a static host. `VITE_BACKEND_URL` is embedded at build time, so a different backend URL requires a new frontend build.

Alternatively, use the published `ghcr.io/pivattogui/allay-frontend` image. It uses the browser origin for backend requests, so the reverse proxy must route `/api` and `/socket` to the backend while routing other paths to the frontend container.

## Configuration ownership

Backend variables belong in `backend/.env` for native development or in the backend runtime environment:

| Variable | Production | Default | Description |
|---|---:|---|---|
| `DATABASE_URL` | required | development database | PostgreSQL connection URL |
| `SECRET_KEY_BASE` | required | development-only value | Phoenix signing secret |
| `FRONTEND_ORIGIN` | required | `http://localhost:5173` in development | Exact browser origin allowed by CORS and Channels |
| `ALLAY_PUBLIC_ORIGIN` | optional | unset | Public backend URL used for its canonical host |
| `MC_PORT_MIN` / `MC_PORT_MAX` | optional | `25565` / `25575` | Minecraft TCP port range |
| `DATA_DIR` | optional | `data` | Runtime data directory |
| `PORT` | optional | `4000` | Backend HTTP port |
| `POOL_SIZE` | optional | `10` | Ecto connection pool size |
| `JAVA_SCAN_DIRS` | optional | platform defaults | Colon-separated JDK roots |

Frontend variables belong in `frontend/.env` or in the frontend build environment:

| Variable | Required | Default | Description |
|---|---:|---|---|
| `VITE_BACKEND_URL` | production | empty | Public backend origin used by REST and WebSocket clients |

`FRONTEND_ORIGIN` and `VITE_BACKEND_URL` describe opposite sides of the boundary: the backend controls which browser origin may connect, while the frontend controls which backend it calls.

## Verification

```bash
cd backend && mix check
cd ../frontend && pnpm lint && pnpm test && pnpm build
```

## License

[AGPL-3.0](LICENSE)
