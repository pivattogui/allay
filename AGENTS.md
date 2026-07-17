# AGENTS.md

This file provides repository-specific guidance for automated coding agents.

## Project overview

Allay is a self-hosted Minecraft server management platform. The Phoenix backend manages Java processes and local server files and persists configuration in PostgreSQL. The independently deployed React frontend consumes its REST API and Phoenix Channels.

The supported production topology is a single Allay application node. Runtime ownership, process registries, logs, metrics, and filesystem access are node-local.

## Projects

| Path | Stack | Port | Purpose |
|---|---|---:|---|
| `backend/` | Elixir 1.18, Phoenix 1.8, Ecto, Oban | 4000 | API, Channels, jobs, and OTP orchestration |
| `frontend/` | React 19, Vite, TanStack Query, Zustand | 5173 | Independently built browser application |

## Development commands

Toolchain versions are declared independently in `backend/.tool-versions` and `frontend/.tool-versions`. Do not add a root `.tool-versions` file.

Start the backend's local PostgreSQL dependency:

```bash
cd backend
docker compose up -d
```

Backend:

```bash
mix setup
mix phx.server
mix test
mix check
mix ecto.migrate
```

Frontend:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm test
pnpm build
```

Without `VITE_BACKEND_URL`, Vite proxies `/api` and `/socket` to Phoenix on port 4000. Production builds call the configured backend directly.

## Backend boundaries

| Module area | Responsibility |
|---|---|
| `Allay.Accounts` | users, API tokens, and request scopes |
| `Allay.Servers` | server configuration, lifecycle, files, and import use cases |
| `Allay.Servers.*` | internal implementations for provisioning, files, imports, and scheduling |
| `Allay.Runtime` | public API for node-local Minecraft runtime processes |
| `Allay.Runtime.*` | per-server supervision tree, Java Port ownership, logs, and metrics |
| `Allay.Backups` | backup persistence, archive, retention, and restore |
| `Allay.Minecraft.*` | version APIs, JAR cache, properties, Java discovery, and RCON |
| `AllayWeb.*` | HTTP and Channel transport boundary only |

The runtime receives a resolved `%Allay.Runtime.Spec{}` and must not read from Ecto directly. Server file and import use cases enter through `Allay.Servers`; their implementation modules remain behind that public context boundary.

Mutating operations for the same server are serialized by `Allay.Servers.OperationLock`, a node-local, fail-fast, reentrant lock backed by a unique OTP Registry. Operations for different servers remain concurrent.

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

The `backend/Dockerfile` creates a Phoenix release and installs Temurin 21 and 25. It does not build or serve the frontend. The image runs Ecto migrations before starting the release and requires `SECRET_KEY_BASE`, `DATABASE_URL`, and `FRONTEND_ORIGIN`.

The frontend produces an independent static artifact under `frontend/dist/`. Its backend origin is provided through `VITE_BACKEND_URL` at build time. No deployment orchestrator is maintained in this repository.

## Required verification

Before considering a change complete, run:

```bash
cd backend && mix check
cd ../frontend
pnpm lint
pnpm test
pnpm build
```

The GitHub Actions workflow runs the same validations. Image publication is part of that workflow and only occurs after lint, backend checks, and frontend checks succeed.

## Dependency and repository rules

- Commit `mix.lock` with backend dependency changes.
- Commit `frontend/pnpm-lock.yaml` with frontend dependency changes.
- Keep Node.js tooling inside `frontend/`; do not add a root package or pnpm workspace.
- Keep generated frontend `dist/` and local backend `_build/`, `deps/`, and PLTs out of commits.
- Use English for code, identifiers, comments, documentation, and commit messages.
