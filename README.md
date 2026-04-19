# Allay

Self-hosted Minecraft server management platform. Create, monitor, and manage multiple Minecraft servers from a single web dashboard.

```
Frontend (React)  ──/api, /ws──►  Backend (Bun + Elysia)  ──►  PostgreSQL
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

## Quick Start

The fastest way to get everything running is with Docker:

```bash
cp .env.example .env
docker compose up -d
```

Open [http://localhost:5173](http://localhost:5173) and create your admin account.

> [!IMPORTANT]
> The default `JWT_SECRET` is for development only. Set a strong secret (16+ characters) in `.env` before exposing the service.

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

In production, the frontend is served by nginx on port 80 and PostgreSQL binds to `127.0.0.1` only.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io)
- [Bun](https://bun.sh)
- [Java](https://adoptium.net) 21+
- [PostgreSQL](https://www.postgresql.org) 17

### Setup

**1. Start the database**

```bash
docker compose up -d postgres
```

**2. Backend**

```bash
cd backend
pnpm install
pnpm db:push   # apply schema
pnpm dev       # http://localhost:3000
```

**3. Frontend**

```bash
cd frontend
pnpm install
pnpm dev       # http://localhost:5173 (proxies /api and /ws to backend)
```

## Environment Variables

All variables have sensible defaults for development. Copy `.env.example` to `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | `allay` | PostgreSQL user |
| `DB_PASSWORD` | `allay` | PostgreSQL password |
| `DB_NAME` | `allay` | PostgreSQL database |
| `DB_PORT` | `5432` | PostgreSQL port |
| `BACKEND_PORT` | `3000` | Backend API port |
| `JWT_SECRET` | dev default | JWT signing secret (min 16 chars) |
| `JWT_EXPIRES_IN` | `24h` | JWT token expiration |
| `MC_PORT_MIN` | `25565` | Minecraft port range start |
| `MC_PORT_MAX` | `25575` | Minecraft port range end |
| `FRONTEND_PORT` | `5173` | Frontend dev server port |

The backend also accepts `DATABASE_URL` (full connection string) and `DATA_DIR` (`./data`) directly.

## Project Structure

```
allay/
├── backend/                 Bun + Elysia API server
│   ├── src/
│   │   ├── routes/          REST endpoints (auth, servers, backups, files, system)
│   │   ├── modules/
│   │   │   ├── process/     Java process spawning and state machine
│   │   │   ├── backups/     tar.gz backups, cron scheduling, retention
│   │   │   ├── metrics/     CPU/RAM monitoring via pidusage
│   │   │   └── scheduler/   Cron-based restart scheduling
│   │   ├── websocket/       WebSocket subscriptions (logs, metrics, status)
│   │   ├── db/              Drizzle schema and migrations
│   │   └── schemas/         Zod request/response validation
│   └── Dockerfile
├── frontend/                React 19 SPA
│   ├── src/
│   │   ├── components/      UI (console, files, backups, settings)
│   │   ├── pages/           Route pages
│   │   ├── hooks/           TanStack Query + WebSocket hooks
│   │   ├── stores/          Zustand (auth, UI, WebSocket)
│   │   └── lib/             API client, query keys, utilities
│   └── Dockerfile
├── docker-compose.yml       Development setup
└── docker-compose.prod.yml  Production overrides
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
