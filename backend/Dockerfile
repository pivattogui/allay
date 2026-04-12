# Base stage
FROM oven/bun:1 AS base
WORKDIR /app

# Development stage
FROM base AS development
# Install Java 21 from Adoptium
RUN apt-get update && apt-get install -y wget apt-transport-https gnupg unzip \
    && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update && apt-get install -y temurin-21-jre \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock* ./
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev"]

# Builder stage
FROM base AS builder
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production stage
FROM base AS production

# Install Java 21 from Adoptium for MC servers
RUN apt-get update && apt-get install -y wget apt-transport-https gnupg curl unzip \
    && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update && apt-get install -y temurin-21-jre \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY --from=builder /app/dist ./dist

ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://allay:allay@postgres:5432/allay
EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
