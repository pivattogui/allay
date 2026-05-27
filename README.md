# Allay

Self-hosted Minecraft server management platform. Create, monitor, and manage multiple Minecraft servers from a single web dashboard.

```
Browser ──►  Allay container  ──►  PostgreSQL
            (Bun + Elysia)
             │
             ├── /            SPA static
             ├── /api/*       REST API
             ├── /ws          WebSocket
             ├── /health      healthcheck
             │
             └── ProcessManager (spawns Java)
```

The backend spawns and manages Java server processes directly. If the backend restarts, it reattaches to running servers automatically.

## Features

- **Server lifecycle** — create, start, stop, restart servers from the browser
- **Real-time console** — live log streaming and command input via WebSocket
- **Backups** — scheduled tar.gz backups with retention policies and one-click restore
- **File manager** — browse, edit, and upload server files
- **Metrics** — per-process CPU and RAM monitoring
- **Version management** — download and switch between server JARs (Vanilla, Paper)
- **Scheduled restarts** — cron-based automatic restarts
- **Authentication** — JWT-based auth with first-run setup wizard

## Self-hosting

The fastest way to run Allay is with the pre-built image from GHCR:

```bash
curl -O https://raw.githubusercontent.com/pivattogui/allay/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/pivattogui/allay/main/.env.example
mv .env.example .env

# Edit .env and set at minimum:
#   JWT_SECRET   (openssl rand -hex 32)
#   DB_PASSWORD  (any strong password)

# Allay runs as a non-root user (uid 1000). Pre-create the data dirs with
# the right ownership so first run can write to them:
mkdir -p data/allay data/postgres
sudo chown -R 1000:1000 data/allay   # postgres handles its own perms

docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080) and create your admin account.

> [!IMPORTANT]
> `JWT_SECRET` and `DB_PASSWORD` are required. The compose file refuses to start without them — there is no insecure fallback.

### Updating

```bash
docker compose pull && docker compose up -d
```

Pin a specific version by setting `ALLAY_VERSION` in `.env` (e.g. `ALLAY_VERSION=1.2.3` or `ALLAY_VERSION=main-abc1234`).

### Behind a reverse proxy

Allay serves the UI, API, and WebSocket all on the same port. A typical Caddy config:

```caddy
allay.example.com {
  reverse_proxy localhost:8080
}
```

When using a reverse proxy with a different public hostname than `localhost`, set `ALLAY_PUBLIC_ORIGIN=https://allay.example.com` in `.env` so CORS allows the public origin.

For nginx, make sure WebSocket upgrade headers are forwarded:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

### Tailscale (zero-config TLS)

If your Allay host is on a tailnet:

```bash
tailscale serve --bg --https=443 http://localhost:8080
```

You'll get an `https://<host>.<tailnet>.ts.net` URL with a valid certificate, no public DNS or Let's Encrypt setup needed.

### Exposing Minecraft to players

The web UI port (`ALLAY_PORT`) goes through your reverse proxy. The Minecraft port range (`MC_PORT_MIN`-`MC_PORT_MAX`, default 25565-25575) is **raw TCP** — it does not go through the HTTP reverse proxy. To let players connect from outside your LAN, open these ports in your router/firewall and forward them to your Allay host.

### Backups

Allay backs up Minecraft worlds via its internal `BackupManager` (configurable per server). **The PostgreSQL database (users, server configs, backup schedules) is NOT auto-backed-up in this release.** Snapshot the `./data/postgres` directory periodically or run `pg_dump` against the bundled postgres container.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io)
- [Bun](https://bun.sh)
- [Java](https://adoptium.net) 21+
- [PostgreSQL](https://www.postgresql.org) 17

### Setup

```bash
docker compose -f docker-compose.dev.yml up -d postgres backend

# In a second terminal, run the frontend natively (faster HMR than via docker):
cd frontend && pnpm install && pnpm dev
```

The dev compose builds the backend from source with hot reload. The frontend's Vite dev server proxies `/api` and `/ws` to `localhost:3000`.

For fully-native dev (no docker):

1. Start PostgreSQL however you prefer (`docker run postgres:17-alpine` or local install).
2. `cd backend && pnpm install && pnpm db:push && pnpm dev`
3. `cd frontend && pnpm install && pnpm dev`

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | yes | _(none)_ | JWT signing secret (min 16 chars) |
| `DB_PASSWORD` | yes | _(none)_ | PostgreSQL password |
| `ALLAY_VERSION` | no | `latest` | Image tag to pull from GHCR |
| `ALLAY_PORT` | no | `8080` | Host port for the web UI |
| `ALLAY_PUBLIC_ORIGIN` | no | _(unset)_ | Public URL when behind a reverse proxy with a different hostname (sets CORS allowed origin) |
| `MC_PORT_MIN` / `MC_PORT_MAX` | no | `25565` / `25575` | Minecraft TCP port range |
| `DB_USER` | no | `allay` | PostgreSQL user |
| `DB_NAME` | no | `allay` | PostgreSQL database name |
| `DATABASE_URL` | no | _(built from above)_ | Override to use external Postgres |
| `JWT_EXPIRES_IN` | no | `24h` | JWT expiration |
| `LOG_LEVEL` | no | `info` | Pino log level |

## Project Structure

```
allay/
├── backend/                 Bun + Elysia API server (also serves the SPA in prod)
│   ├── src/
│   │   ├── routes/          REST endpoints
│   │   ├── modules/         Process, backups, metrics, scheduler, import
│   │   ├── websocket/       WebSocket subscriptions
│   │   ├── db/              Drizzle schema and migrations
│   │   ├── schemas/         Zod request/response validation
│   │   ├── static.ts        Static + SPA fallback for production
│   │   └── app.ts           Elysia app composition
│   └── Dockerfile           Unified multi-stage (frontend build + backend + runtime)
├── frontend/                React 19 SPA source (built into the backend image)
│   └── src/
├── docker-compose.yml       Production: pulls ghcr.io/pivattogui/allay
└── docker-compose.dev.yml   Development: builds backend from source
```

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| API | [Elysia](https://elysiajs.com) |
| Database | [PostgreSQL 17](https://www.postgresql.org) + [Drizzle ORM](https://orm.drizzle.team) |
| Frontend | [React 19](https://react.dev) + [Vite](https://vite.dev) + [TanStack Query](https://tanstack.com/query) |
| UI | [Tailwind CSS](https://tailwindcss.com) + [Radix UI](https://www.radix-ui.com) |
| Validation | [Zod](https://zod.dev) |

## License

[AGPL-3.0](LICENSE) — if you run Allay as a public service, you must publish your modifications.
