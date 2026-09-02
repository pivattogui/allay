<div align="center">
  <img src="docs/readme/assets/allay-mark.svg" alt="Allay logo" width="88" height="88">
  <h1>Allay</h1>
  <p><strong>Self-hosted Minecraft server management, built for control.</strong></p>
  <p>Run, observe, configure, and protect Minecraft Java servers from one focused control panel.</p>

  <p>
    <a href="https://github.com/pivattogui/allay/actions/workflows/ci.yml"><img src="https://github.com/pivattogui/allay/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2563eb.svg" alt="License: AGPL-3.0"></a>
    <img src="https://img.shields.io/badge/Elixir-1.18-4B275F.svg" alt="Elixir 1.18">
    <img src="https://img.shields.io/badge/React-19-149ECA.svg" alt="React 19">
    <img src="https://img.shields.io/badge/status-active%20development-f59e0b.svg" alt="Status: active development">
  </p>
</div>

![Allay orchestration hero](docs/readme/assets/hero.webp)

> [!IMPORTANT]
> Allay is under active development. Interfaces, deployment requirements, and persisted configuration may change before the first stable release.

## Why Allay

Minecraft administration often means combining shell sessions, process managers, file tools, backup scripts, and monitoring. Allay brings those responsibilities together while keeping the server and its data on infrastructure you control.

It is designed for a **single Allay application node**. The Phoenix backend owns the local Java processes and filesystem; the React frontend is an independently built client that communicates through REST and Phoenix Channels.

![Allay server overview showing running, stopped, and starting servers](docs/readme/assets/servers-overview.webp)

## Features

- **Server lifecycle** — provision, start, stop, kill, migrate, and remove Vanilla or Paper servers.
- **Live operations** — stream console logs, send commands, and inspect CPU, memory, and player metrics in real time.
- **File management** — browse, edit, upload, download, rename, and remove files within a sandboxed server directory.
- **Backups and restore** — create, download, restore, and retain manual or scheduled archives.
- **Safe imports** — analyze uploaded archives, review detected content, and create a pre-import backup before extraction.
- **Configuration** — manage JVM resources, Java versions, restart behavior, schedules, server metadata, and `server.properties`.
- **Authentication** — protect both REST requests and server channels with database-backed bearer tokens.
- **Runtime resilience** — supervise each Minecraft process through an isolated OTP subtree with readiness determined by RCON.

## Product tour

### Live console and metrics

Follow startup output, server activity, resource usage, and connected players without leaving the control panel.

![Allay live console with CPU, memory, player metrics, and server logs](docs/readme/assets/server-console.webp)

### Files and configuration

Inspect the server directory and edit supported configuration files from the browser. Filesystem operations are constrained to each server's managed root.

![Allay file manager editing server.properties](docs/readme/assets/file-manager.webp)

## Engineering highlights

- A Phoenix 1.8 API provides explicit context boundaries for accounts, servers, backups, Minecraft integration, and runtime orchestration.
- Each active server runs under its own OTP supervision tree; `ServerRuntime` owns the Java port while dedicated processes watch logs and sample metrics.
- Per-server mutations are serialized with a fail-fast, reentrant operation lock while different servers remain concurrent.
- Runtime state never depends directly on Ecto: persisted configuration is resolved into an `Allay.Runtime.Spec` before reaching the process layer.
- Oban persists restart and backup schedules, while Phoenix PubSub carries node-local status, log, and metric events to Channels.
- Path validation, streamed uploads, archive analysis, pre-import backups, and short-lived download tickets keep file operations behind the server context boundary.

## Architecture

```mermaid
flowchart LR
  browser[Administrator browser]
  players[Minecraft clients]

  subgraph frontend[React application]
    ui[Pages and components]
    query[TanStack Query]
    channel[Phoenix socket client]
    ui --> query
    ui --> channel
  end

  subgraph node[Single Allay application node]
    api[Phoenix REST API]
    sockets[Phoenix Channels]
    contexts[Application contexts]
    jobs[Oban workers]
    runtime[Per-server OTP trees]
    files[(Managed data directory)]
    java[Java server processes]

    api --> contexts
    sockets --> contexts
    contexts --> runtime
    jobs --> contexts
    contexts --> files
    runtime --> java
    runtime -. logs, metrics, status .-> sockets
  end

  postgres[(PostgreSQL)]

  browser --> frontend
  query --> api
  channel --> sockets
  contexts --> postgres
  jobs --> postgres
  players --> java
```

The runtime registry, process ownership, live events, metrics, and filesystem access are node-local. PostgreSQL stores users, tokens, server configuration, backup metadata, and Oban jobs; it is not included in Minecraft backups.

## Technology

| Area | Stack | Responsibility |
|---|---|---|
| Backend | Elixir 1.18, Phoenix 1.8, Ecto | REST API, authentication, persistence, and domain boundaries |
| Runtime | OTP, Erlang Ports, RCON, Phoenix PubSub | Java process ownership, lifecycle, readiness, logs, and metrics |
| Jobs | Oban | Durable backup and restart schedules |
| Frontend | React 19, TypeScript, Vite | Independently deployed browser application |
| Client state | TanStack Query, Zustand, Phoenix Channels | Server state, authentication, and live events |
| Storage | PostgreSQL 17 and local filesystem | Configuration, jobs, server files, JARs, imports, and backups |
| Delivery | Docker, Nginx, GitHub Actions, GHCR | Multi-architecture images and continuous verification |

## Getting started

### Requirements

- Erlang/OTP 27 and Elixir 1.18
- Node.js 22 and pnpm 10
- PostgreSQL 17, or Docker for the provided development database
- Java 21 and/or 25 to run Minecraft servers locally

Toolchain versions are declared independently in `backend/.tool-versions` and `frontend/.tool-versions`. The repository intentionally has no root toolchain or JavaScript workspace.

### 1. Start PostgreSQL

The Compose file starts only the local database dependency:

```bash
cd backend
docker compose up -d
```

### 2. Start the backend

```bash
cd backend
cp .env.example .env
mix setup
mix phx.server
```

The development default uses `ecto://allay:allay@localhost:5432/allay_dev` and listens on `http://localhost:4000`.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173` and create the initial administrator account. With no frontend environment file, Vite proxies `/api` and `/socket` to the backend on port 4000.

## Deployment artifacts

Allay publishes the backend and frontend as separate images:

```bash
docker pull ghcr.io/pivattogui/allay-backend:latest
docker pull ghcr.io/pivattogui/allay-frontend:latest
```

The backend image contains the Phoenix release and Temurin 21 and 25 runtimes. It runs Ecto migrations before startup and requires `DATABASE_URL`, `SECRET_KEY_BASE`, and `FRONTEND_ORIGIN`.

The frontend image serves the static build through Nginx and uses the browser origin for backend requests. A reverse proxy must route `/api` and `/socket` to Phoenix and all other paths to the frontend. This repository deliberately does not prescribe a production orchestrator.

To build the artifacts independently:

```bash
cd backend
docker build -t allay-backend .

cd ../frontend
VITE_BACKEND_URL=https://api.allay.example pnpm build
```

`VITE_BACKEND_URL` is embedded into a static frontend build. Changing the backend origin requires rebuilding that artifact.

## Configuration

Backend variables belong in `backend/.env` for native development or in the backend runtime environment:

| Variable | Production | Default | Description |
|---|---:|---|---|
| `DATABASE_URL` | Required | Development database | PostgreSQL connection URL |
| `SECRET_KEY_BASE` | Required | Development-only value | Phoenix signing secret |
| `FRONTEND_ORIGIN` | Required | `http://localhost:5173` in development | Exact browser origin accepted by CORS and Channels |
| `ALLAY_PUBLIC_ORIGIN` | Optional | Unset | Public backend origin used for its canonical host |
| `MC_PORT_MIN` / `MC_PORT_MAX` | Optional | `25565` / `25575` | Allocatable Minecraft TCP port range |
| `DATA_DIR` | Optional | `data` | Root for servers, backups, imports, and cached JARs |
| `PORT` | Optional | `4000` | Backend HTTP port |
| `POOL_SIZE` | Optional | `10` | Ecto connection pool size |
| `JAVA_SCAN_DIRS` | Optional | Platform defaults | Colon-separated JDK installation roots |

Frontend configuration belongs in `frontend/.env` or the build environment:

| Variable | Production | Default | Description |
|---|---:|---|---|
| `VITE_BACKEND_URL` | Required for separate origins | Empty | Backend origin used by REST and WebSocket clients |

`FRONTEND_ORIGIN` tells the backend which browser origin may connect. `VITE_BACKEND_URL` tells the browser which backend to call.

## Repository structure

```text
allay/
├── backend/   Phoenix API, persistence, jobs, and Minecraft runtime
├── frontend/  React browser application and static image
└── docs/      Architecture notes and project documentation
```

## Development

Run the same validations enforced by GitHub Actions:

```bash
cd backend && mix check
cd ../frontend && pnpm lint && pnpm test && pnpm build
```

Backend changes must preserve the public context boundaries described in `AGENTS.md`. Frontend and backend dependencies keep independent lockfiles and release lifecycles.

## Contributing

Issues and focused pull requests are welcome. Before submitting a change:

1. Keep code, identifiers, comments, documentation, and commit messages in English.
2. Add or update tests for changed behavior.
3. Run the complete verification commands above.
4. Describe the motivation and operational impact of the change.

## License

Allay is available under the [GNU Affero General Public License v3.0](LICENSE).
