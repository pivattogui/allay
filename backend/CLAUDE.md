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
| `JWT_SECRET` | JWT signing secret (min 16 chars) | dev default |
| `DATA_DIR` | Base data directory | `./data` |
| `PORT` | API port | `3000` |
