# AGENTS.md

This file provides repository-specific guidance for automated coding agents.

## Project overview

Allay is a self-hosted Minecraft server management platform. The Phoenix backend manages Java processes and local server files, persists configuration in PostgreSQL, and serves both a REST API and Phoenix Channels consumed by the React SPA.

The supported production topology is a single Allay application node. Runtime ownership, process registries, logs, metrics, and filesystem access are node-local.

See `ARCHITECTURE.md` for the complete architecture map.

## Projects

| Path | Stack | Port | Purpose |
|---|---|---:|---|
| `backend/` | Elixir 1.18, Phoenix 1.8, Ecto, Oban | 4000 | API, Channels, static SPA, jobs, and OTP orchestration |
| `frontend/` | React 19, Vite, TanStack Query, Zustand | 5173 | SPA source; compiled into the Phoenix release |

## Development commands

Start PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

Backend:

```bash
cd backend
mix setup
mix phx.server
mix test
mix check
mix ecto.migrate
```

Frontend, from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:frontend
pnpm lint
pnpm test:frontend
pnpm build
```

Vite proxies `/api` and `/socket` to Phoenix on port 4000.

## Backend boundaries

| Module area | Responsibility |
|---|---|
| `Allay.Accounts` | users, API tokens, and request scopes |
| `Allay.Servers` | persisted server configuration and lifecycle use cases |
| `Allay.Runtime` | public API for node-local Minecraft runtime processes |
| `Allay.Runtime.*` | per-server supervision tree, Java Port ownership, logs, and metrics |
| `Allay.Backups` | backup persistence, archive, retention, and restore |
| `Allay.Files` | sandboxed server filesystem operations |
| `Allay.Imports` | archive analysis and import execution |
| `Allay.Minecraft.*` | version APIs, JAR cache, properties, Java discovery, and RCON |
| `AllayWeb.*` | HTTP and Channel transport boundary only |

The runtime receives a resolved `%Allay.Runtime.Spec{}` and must not read from Ecto directly. Controllers and Channels delegate domain work to contexts.

## Runtime model

`Allay.Runtime.Supervisor` owns a unique Registry and a DynamicSupervisor. Each active Minecraft server has an `InstanceSupervisor` containing:

- `ServerRuntime`, the Java Port owner and lifecycle state machine;
- `LogWatcher`, which tails `logs/latest.log`;
- `MetricsSampler`, started temporarily after the runtime reaches `running`.

Runtime states are:

```text
stopped -> starting -> running -> stopping -> stopped
                    \-> crashed
```

Readiness is determined by an RCON handshake. Runtime events are broadcast through Phoenix PubSub and serialized by `AllayWeb.ServerChannel`.

## Persistence and jobs

- Ecto schemas persist users, tokens, servers, backup configurations, and backups.
- Oban persists scheduled backup and restart jobs.
- Application data is stored under `DATA_DIR` in `servers/`, `backups/`, `imports/`, and `jars/`.
- PostgreSQL is not included in application-level Minecraft backups.

## Authentication

REST routes use `AllayWeb.Plugs.ApiAuth`, which resolves a database-backed bearer token into `%Allay.Accounts.Scope{}`. `AllayWeb.UserSocket` validates the same token during connection and assigns the scope used to authorize server channels.

## Production

The multi-stage `backend/Dockerfile` builds the React SPA, creates a Phoenix release, and installs Temurin 21 and 25. The image runs Ecto migrations before starting the release. Production requires `SECRET_KEY_BASE` and `DATABASE_URL`; Compose derives the latter from the database settings.

## Required verification

Before considering a change complete, run:

```bash
cd backend && mix check
pnpm lint
pnpm test:frontend
pnpm build
```

The GitHub Actions workflow runs the same validations. Image publication is part of that workflow and only occurs after lint, backend checks, and frontend checks succeed.

## Dependency and repository rules

- Commit `mix.lock` with backend dependency changes.
- Commit the root `pnpm-lock.yaml` with frontend dependency changes.
- Do not add backend packages to the pnpm workspace.
- Keep generated frontend `dist/` and local backend `_build/`, `deps/`, and PLTs out of commits.
- Use English for code, identifiers, comments, documentation, and commit messages.
