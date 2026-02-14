# Multi-stage Dockerfile for OttoChain Services
# Builds: bridge, gateway, indexer, traffic-generator, monitor

FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/traffic-generator/package.json ./packages/traffic-generator/
COPY packages/monitor/package.json ./packages/monitor/
COPY packages/shared/package.json ./packages/shared/
COPY prisma ./prisma

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code (exclude problematic packages)
COPY packages/bridge ./packages/bridge
COPY packages/gateway ./packages/gateway
COPY packages/indexer ./packages/indexer
COPY packages/traffic-generator ./packages/traffic-generator
COPY packages/monitor ./packages/monitor
COPY packages/shared ./packages/shared

# Generate Prisma client
RUN pnpm db:generate

# Build only the packages we need
RUN pnpm --filter @ottochain/shared build
RUN pnpm --filter @ottochain/bridge build
RUN pnpm --filter @ottochain/gateway build
RUN pnpm --filter @ottochain/indexer build
RUN pnpm --filter @ottochain/traffic-generator build
RUN pnpm --filter @ottochain/monitor build

# Bridge service
FROM node:20-alpine AS bridge
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/bridge/dist ./packages/bridge/dist
COPY --from=base /app/packages/bridge/package.json ./packages/bridge/
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
EXPOSE 3030
CMD ["node", "packages/bridge/dist/index.js"]

# Gateway service
FROM node:20-alpine AS gateway
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=base /app/packages/gateway/package.json ./packages/gateway/
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
EXPOSE 4000
CMD ["node", "packages/gateway/dist/index.js"]

# Indexer service
FROM node:20-alpine AS indexer
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/indexer/dist ./packages/indexer/dist
COPY --from=base /app/packages/indexer/package.json ./packages/indexer/
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
EXPOSE 3031
CMD ["node", "packages/indexer/dist/index.js"]

# Traffic Generator service
FROM node:20-alpine AS traffic-generator
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/traffic-generator/dist ./packages/traffic-generator/dist
COPY --from=base /app/packages/traffic-generator/package.json ./packages/traffic-generator/
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
CMD ["node", "packages/traffic-generator/dist/index.js"]

# Monitor service
FROM node:20-alpine AS monitor
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/monitor/dist ./packages/monitor/dist
COPY --from=base /app/packages/monitor/package.json ./packages/monitor/
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
CMD ["node", "packages/monitor/dist/index.js"]