# Allay - Frontend

Web interface for server management.

## Stack

- React 19 + TypeScript
- Vite
- TailwindCSS + shadcn/ui
- React Router

## Requirements

- Node.js 22+
- pnpm

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables (optional)
cp .env.example .env

# Start in development
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with hot-reload (port 5173) |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview build |
| `pnpm lint` | Run ESLint |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3000` |

## Development

Vite proxy automatically forwards:
- `/api/*` -> Backend API
- `/ws/*` -> Backend WebSocket

Make sure the backend is running on `localhost:3000`.

## Structure

```
src/
├── api/          # API clients
├── components/   # React components
│   └── ui/       # shadcn/ui components
├── hooks/        # Custom hooks
├── lib/          # Utilities
├── pages/        # Pages/routes
├── stores/       # Global state
└── App.tsx       # Root component
```

## Docker

```bash
docker build -t allay-frontend .
docker run -p 80:80 allay-frontend
```

Dockerfile uses nginx to serve static files in production.
