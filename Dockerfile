# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm and OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/monitor/package.json ./packages/monitor/
COPY packages/traffic-generator/package.json ./packages/traffic-generator/
COPY packages/shared/package.json ./packages/shared/

# Copy Prisma schema (needed for prisma generate)
COPY prisma ./prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm --filter indexer prisma generate

# Build all packages
RUN pnpm run build

# Production stage
FROM node:20-slim AS production

# Version info (injected at build time)
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG VERSION=0.0.0

ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
ENV npm_package_version=$VERSION

WORKDIR /app

# Install pnpm, netcat for health checks, and OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl netcat-openbsd && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8 --activate

# Copy built artifacts
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma schema (needed for runtime migrations via prisma db push)
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Service selection via environment variable
# Valid services: gateway, bridge, indexer, monitor, traffic-generator
#
# Port mapping:
#   gateway:  4000 - Main API gateway
#   bridge:   3030 - OttoChain bridge service
#   indexer:  3031 - Blockchain indexer (requires DATABASE_URL)
#   monitor:  3032 - Monitoring service
#
ENV SERVICE=gateway
ENV NODE_ENV=production

EXPOSE 4000 3030 3031 3032

ENTRYPOINT ["docker-entrypoint.sh"]
