# syntax=docker/dockerfile:1.7

# ---- frontend-builder ----
FROM node:22-slim AS frontend-builder
RUN corepack enable
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN pnpm install --frozen-lockfile --filter allay-frontend...
COPY frontend ./frontend
RUN pnpm --filter allay-frontend build
# Output: /workspace/frontend/dist

# ---- backend-builder ----
FROM oven/bun:1 AS backend-builder
WORKDIR /app
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile
COPY backend ./
RUN bun build src/index.ts src/db/migrate.ts --target bun --outdir dist --minify
# Output: /app/dist/{index.js,migrate.js}

# ---- runtime ----
FROM oven/bun:1 AS runtime

# Java 21 JRE for Minecraft server processes
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      wget apt-transport-https gnupg curl unzip ca-certificates \
 && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" \
      > /etc/apt/sources.list.d/adoptium.list \
 && apt-get update && apt-get install -y --no-install-recommends temurin-21-jre \
 && rm -rf /var/lib/apt/lists/*

# Use the non-root user already provided by the base image
WORKDIR /app

COPY backend/package.json backend/bun.lock ./
RUN bun install --production --frozen-lockfile

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/drizzle ./drizzle
COPY --from=frontend-builder /workspace/frontend/dist ./public

RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

# Apply migrations on startup, then run the server
CMD ["sh", "-c", "bun run dist/db/migrate.js && bun run dist/index.js"]
