# Allay frontend

Independent React browser client for the Allay backend.

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite runs on port `5173`. With no `.env`, it proxies `/api` and `/socket` to `http://localhost:4000`.

To call a backend directly:

```bash
cp .env.example .env
pnpm dev
```

`VITE_BACKEND_URL` must be an origin without a trailing path, such as `https://api.allay.example`. The backend must allow the frontend's browser origin through `FRONTEND_ORIGIN`.

## Production artifact

```bash
VITE_BACKEND_URL=https://api.allay.example pnpm build
```

The deployable static artifact is written to `dist/`. The backend URL is embedded at build time.

The published `ghcr.io/pivattogui/allay-frontend` image leaves `VITE_BACKEND_URL` empty and uses the browser origin. A reverse proxy must route `/api` and `/socket` to the backend while routing other paths to the frontend container.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the development server |
| `pnpm build` | Type-check and build the static artifact |
| `pnpm preview` | Preview the built artifact |
| `pnpm test` | Run frontend tests |
| `pnpm lint` | Run Biome lint and formatting checks |
