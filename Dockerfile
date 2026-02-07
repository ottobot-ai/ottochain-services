# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/monitor/package.json ./packages/monitor/
COPY packages/traffic-generator/package.json ./packages/traffic-generator/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm --filter indexer prisma generate

# Build all packages
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8 --activate

# Install netcat for database health checks
RUN apk add --no-cache netcat-openbsd

# Copy built artifacts
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

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
