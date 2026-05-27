# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Allay is a Minecraft server management backend that handles server lifecycle (start/stop/restart), backups, file management, and real-time monitoring via WebSocket.

## Stack

- **Runtime**: Bun
- **Framework**: Elysia (REST API + WebSocket)
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod

## Commands

```bash
# Development
pnpm dev                  # Start with hot-reload (port 3000)

# Build & Production
pnpm build                # Build for production
pnpm start                # Run production build

# Type checking & Linting
pnpm typecheck            # TypeScript type check (tsc --noEmit)
pnpm lint                 # Run ESLint

# Database
pnpm db:generate          # Generate Drizzle migrations
pnpm db:migrate           # Run migrations
pnpm db:push              # Push schema directly (dev)
pnpm db:studio            # Open Drizzle Studio
```

## Architecture

### Entry Point & App Setup
- `src/index.ts` - Application entry, initializes directories, starts server, handles graceful shutdown
- `src/app.ts` - Elysia app configuration, middleware (CORS, JWT), route registration, service initialization
- `src/config.ts` - Environment config with Zod validation

### Database Layer (`src/db/`)
- `schema.ts` - Drizzle schema definitions (users, servers, backupConfigs, backups, events)
- `index.ts` - PostgreSQL connection via `postgres` package
- `migrate.ts` - Migration runner

### Routes (`src/routes/`)
All routes are Elysia plugins prefixed with `/api`:
- `auth.ts` - Authentication (setup, login, JWT verification via `.resolve()`)
- `servers.ts` - CRUD + start/stop/status/logs/command
- `backups.ts` - Backup CRUD, restore, config
- `files.ts` - Server file browser/editor
- `system.ts` - System info, Minecraft versions

### Core Modules (`src/modules/`)
- `process/index.ts` - **ProcessManager**: Spawns Java processes, manages stdin/stdout, tracks state (stopped/starting/running/stopping/crashed), emits events for logs and status changes
- `backups/index.ts` - **BackupManager**: Creates tar.gz backups, cron scheduling, retention policy, restore with rollback
- `metrics/index.ts` - **MetricsCollector**: CPU/RAM monitoring via pidusage
- `scheduler/restart-scheduler.ts` - Cron-based server restart scheduling
- `import/` - Server import system (detect existing servers, validate, apply config)

### WebSocket (`src/websocket/handler.ts`)
- Single `/ws` endpoint
- Subscription model: clients subscribe to `logs`, `metrics`, or `status` channels per server
- Broadcasts ProcessManager events to subscribed clients

### Types (`src/types/`)
- `index.ts` - All domain types and Zod schemas (Server, Backup, ServerState, etc.)
- `ws.ts` - WebSocket client type definitions

### Static & SPA serving (`src/static.ts`)
In production builds, the React frontend is built into `public/` and served by Elysia via `@elysiajs/static`:
- `/` → `public/index.html` (SPA entry, served manually due to a non-Bun runtime quirk in the plugin)
- `/assets/*` → hashed static assets with `Cache-Control: public, max-age=31536000, immutable`
- Any unmatched non-`/api`, non-`/ws`, non-`/health` path → `index.html` (SPA fallback for client-side routing)

In development (`pnpm dev`), `public/` does not exist; the frontend runs separately via Vite on port 5173 with a proxy to the backend.

The plugin uses `alwaysStatic: true` so it registers explicit per-file routes instead of its own wildcard, leaving the `/*` SPA fallback to handle unknown paths.

## Key Patterns

### Authentication
Routes use Elysia's `.resolve()` to verify JWT and inject `user` context. Auth routes before `.resolve()` are public, after are protected.

### Process Management
ProcessManager is a singleton EventEmitter. Server processes are tracked in a Map by serverId. State transitions: stopped -> starting -> running -> stopping -> stopped (or crashed).

### Graceful Shutdown
Minecraft servers are stopped with the `stop` command via stdin before SIGTERM, with configurable timeout fallback.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://allay:allay@localhost:5432/allay` |
| `JWT_SECRET` | JWT signing secret (min 16 chars) | _(required — no default)_ |
| `ALLAY_PUBLIC_ORIGIN` | Public URL of the deployment (sets CORS allowed origin). Leave empty for same-origin. | _(unset)_ |
| `DATA_DIR` | Base data directory | `./data` |
| `PORT` | API port | `3000` |

## Dual package manager gotcha

This repo uses **both** Bun (runtime + container) and pnpm (workspace + dev tooling). Each has its own lockfile (`bun.lock`, `pnpm-lock.yaml`) and per the repo rules both must be committed together when a backend dependency changes.

When adding a dependency with `pnpm add --filter allay-backend`, pnpm may resolve a different version than what's pinned in `bun.lock`. If you also run `bun install` locally, you can end up with two distinct `node_modules/elysia` (one bun-installed under `backend/node_modules/`, one pnpm-hoisted under `node_modules/.pnpm/`). TypeScript will see them as distinct types and `tsc` will fail with cross-module assignability errors.

Recovery:
1. Run `bun update <dep>` in `backend/` to align bun.lock to the same version pnpm resolved.
2. If `backend/node_modules` has real (bun-installed) packages and you also have pnpm `.pnpm/` copies, delete `backend/node_modules` and run `pnpm install` from the repo root to recreate it as a symlink farm. Local dev typechecks only against the pnpm-hoisted copy this way. Containers still get a clean `bun install` inside the runtime image.
