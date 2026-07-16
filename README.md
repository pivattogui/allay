# Allay

Self-hosted Minecraft server management platform. Create, monitor, and manage multiple Minecraft servers from a single web dashboard.

```text
Browser ──► Allay container ──► PostgreSQL
            Phoenix release
                 │
                 ├── /             React SPA
                 ├── /api/*        REST API
                 ├── /socket       Phoenix Channels
                 ├── /health       liveness endpoint
                 └── OTP runtimes ──► Java server processes
```

The supported deployment topology is one Allay application node controlling local Minecraft processes and files. On application startup, servers configured with `auto_start` are started. All other servers remain stopped.

## Features

- **Server lifecycle** — create, start, stop, restart, and migrate servers
- **Real-time console** — live logs, metrics, status, and commands through Phoenix Channels
- **Backups** — manual and scheduled tar.gz backups with retention and restore
- **File manager** — browse, edit, download, and upload server files
- **Metrics** — per-process CPU, RAM, and player monitoring
- **Version management** — download and switch between Vanilla and Paper versions
- **Scheduled restarts** — persistent Oban-backed cron scheduling
- **Authentication** — database-backed API tokens with a first-run setup wizard

## Self-hosting

Download the production compose file and environment template:

```bash
curl -O https://raw.githubusercontent.com/pivattogui/allay/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/pivattogui/allay/main/.env.example
mv .env.example .env
```

Set at least these values in `.env`:

```dotenv
SECRET_KEY_BASE=<generate-with-mix-phx.gen.secret>
DB_PASSWORD=<strong-database-password>
```

Create the application data directory with the runtime user's ownership, then start the stack:

```bash
mkdir -p data/allay data/postgres
sudo chown -R 1000:1000 data/allay
docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080) and create the administrator account.

`SECRET_KEY_BASE` and `DB_PASSWORD` are required. Compose refuses to start without them.

### Updating

```bash
docker compose pull
docker compose up -d
```

Pin a release with `ALLAY_VERSION`, for example `1.2.3`, `1.2`, or `main-abc1234`.

### Reverse proxy

Allay serves the SPA, API, and WebSocket endpoint on the same HTTP port. Example Caddy configuration:

```caddy
allay.example.com {
  reverse_proxy localhost:8080
}
```

Set `ALLAY_PUBLIC_ORIGIN=https://allay.example.com` so Phoenix can validate the WebSocket origin and generate the canonical URL.

For nginx, forward WebSocket upgrade headers:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

### Minecraft ports

The web UI uses `ALLAY_PORT`. Minecraft uses the raw TCP range configured by `MC_PORT_MIN` and `MC_PORT_MAX`, defaulting to `25565` through `25575`. Expose and forward that range directly to the Allay host.

### Data backup

Allay backs up Minecraft server data. It does not back up PostgreSQL. Back up `./data/postgres` or use `pg_dump` in addition to the application backups.

## Local development

### Requirements

- Erlang/OTP 27 and Elixir 1.18
- Node.js 22 and pnpm 10
- PostgreSQL 17
- Java 21 and/or 25 for running Minecraft locally

Versions used by CI are recorded in `backend/.tool-versions` and the root `package.json`.

### Setup

Start PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

Run the backend:

```bash
cd backend
mix setup
mix phx.server
```

Run the frontend in another terminal:

```bash
pnpm install --frozen-lockfile
pnpm dev:frontend
```

Vite runs on port `5173` and proxies `/api` and `/socket` to Phoenix on port `4000`.

### Verification

```bash
cd backend && mix check
pnpm lint
pnpm test:frontend
pnpm build
```

`mix check` runs compilation with warnings as errors, formatting, Credo, Dialyzer, and the backend test suite.

## Configuration

| Variable | Required | Default | Description |
|---|---:|---|---|
| `SECRET_KEY_BASE` | production | none | Phoenix signing secret |
| `DB_PASSWORD` | bundled PostgreSQL | none | PostgreSQL password |
| `DATABASE_URL` | production | derived by Compose | Ecto connection URL |
| `ALLAY_VERSION` | no | `latest` | Container image tag |
| `ALLAY_PORT` | no | `8080` | Host port mapped to container port 4000 |
| `ALLAY_PUBLIC_ORIGIN` | no | unset | Canonical public origin and WebSocket allowlist |
| `MC_PORT_MIN` / `MC_PORT_MAX` | no | `25565` / `25575` | Minecraft TCP port range |
| `DATA_DIR` | no | `data` locally, `/app/data` in the image | Runtime data directory |
| `PORT` | no | `4000` | Phoenix HTTP port |
| `POOL_SIZE` | no | `10` | Ecto connection pool size |
| `JAVA_SCAN_DIRS` | no | platform defaults | Colon-separated JDK roots for native development |

## Project structure

```text
allay/
├── backend/                 Phoenix application and OTP runtime orchestration
│   ├── lib/allay/           contexts, schemas, workers, and runtime processes
│   ├── lib/allay_web/       REST API, Channels, and SPA serving
│   ├── priv/repo/           Ecto migrations
│   └── Dockerfile           frontend build + Phoenix release + Java runtimes
├── frontend/                React 19 SPA
├── docker-compose.yml       production deployment
└── docker-compose.dev.yml   development PostgreSQL
```

## Stack

| Layer | Technology |
|---|---|
| Backend | Elixir 1.18, Phoenix 1.8, OTP |
| Persistence | PostgreSQL 17, Ecto, Oban |
| Realtime | Phoenix Channels and PubSub |
| Frontend | React 19, Vite, TanStack Query, Zustand |
| UI | Tailwind CSS and Radix UI |
| Minecraft runtime | Temurin Java 21 and 25 |

## License

[AGPL-3.0](LICENSE)
