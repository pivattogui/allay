# Allay - Backend

REST API for server management.

## Stack

- Node.js 22 + TypeScript
- Fastify (REST API + WebSocket)
- SQLite (better-sqlite3)
- Zod (validation)

## Requirements

- Node.js 22+
- pnpm
- Java 21+ (for game servers)

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Start in development
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with hot-reload (port 3000) |
| `pnpm build` | Build for production |
| `pnpm start` | Start production build |
| `pnpm typecheck` | TypeScript type check |
| `pnpm lint` | Run ESLint |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | `development` |
| `PORT` | API port | `3000` |
| `DATA_DIR` | Data directory | `./data` |
| `JWT_SECRET` | JWT secret (min 16 chars) | - |
| `JWT_EXPIRES_IN` | Token expiration | `24h` |
| `DATABASE_PATH` | SQLite path | `{DATA_DIR}/database.sqlite` |

## Data Structure

```
data/
├── servers/      # Server instances
├── backups/      # Backup files
├── jars/         # Downloaded JARs cache
└── database.sqlite
```

## API Endpoints

### Auth
- `POST /api/auth/setup` - Create first user
- `POST /api/auth/login` - Login (returns JWT)
- `GET /api/auth/me` - Current user

### Servers
- `GET /api/servers` - List servers
- `POST /api/servers` - Create server
- `GET /api/servers/:id` - Details
- `PATCH /api/servers/:id` - Update
- `DELETE /api/servers/:id` - Delete
- `POST /api/servers/:id/start` - Start
- `POST /api/servers/:id/stop` - Stop
- `GET /api/servers/:id/status` - Status
- `GET /api/servers/:id/logs` - Logs

### Backups
- `GET /api/backups/:serverId` - List backups
- `POST /api/backups/:serverId` - Create backup
- `POST /api/backups/:serverId/:backupId/restore` - Restore
- `DELETE /api/backups/:serverId/:backupId` - Delete

### System
- `GET /api/system/info` - System info
- `GET /api/system/versions/:type` - Available versions

## Docker

```bash
docker build -t allay-backend .
docker run -p 3000:3000 -v $(pwd)/data:/app/data allay-backend
```
