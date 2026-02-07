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

# Copy built artifacts
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Default to gateway, override with command
ENV SERVICE=gateway
ENV NODE_ENV=production

EXPOSE 4000 3030 3031 3032

CMD ["sh", "-c", "pnpm --filter $SERVICE start"]
