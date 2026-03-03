# Allay

Server manager with a modern web panel.

## Projects

| Project | Description | Port |
|---------|-------------|------|
| [backend](./backend) | REST API + WebSocket | 3000 |
| [frontend](./frontend) | React web interface | 5173 |

## Quick Start

```bash
# Terminal 1 - Backend
cd backend
pnpm install
cp .env.example .env
pnpm dev

# Terminal 2 - Frontend
cd frontend
pnpm install
pnpm dev

# Access: http://localhost:5173
```

## Features

- Multi-server management
- Vanilla and Paper support
- Automatic JAR downloads
- Start/Stop/Restart via web interface
- Real-time status monitoring
- Automated backups
- JWT authentication
- Responsive dark theme interface

## Requirements

- Node.js 22+
- pnpm
- Java 21+ (for game servers)
