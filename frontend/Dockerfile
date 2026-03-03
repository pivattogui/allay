# Base stage
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# Development stage
FROM base AS development
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

# Builder stage
FROM base AS builder
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production stage
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
