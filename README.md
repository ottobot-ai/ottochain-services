# OttoChain Services

TypeScript companion services for the OttoChain metagraph — providing API gateway, transaction bridge, and indexing for the Agent Identity Platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENTS                             │
│   Explorer UI  │  Discord Bot  │  Telegram Bot  │  SDKs    │
└───────┬────────┴───────┬───────┴───────┬────────┴──────────┘
        │                │               │
        └────────────────┴───────┬───────┘
                                 │
                    ┌────────────▼────────────┐
                    │     API GATEWAY         │
                    │     (GraphQL + WS)      │
                    │     Port 4000           │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
       ┌──────▼──────┐    ┌──────▼──────┐   ┌──────▼──────┐
       │  POSTGRES   │    │   BRIDGE    │   │   INDEXER   │
       │  (indexed   │    │ (Port 3030) │   │ (Port 3031) │
       │   state)    │    └──────┬──────┘   └──────┬──────┘
       └──────▲──────┘           │                 │
              │                  │                 │
              │           ┌──────▼─────────────────▼──────┐
              └───────────┤        METAGRAPH              │
                          │   (OttoChain GL0/ML0/DL1)     │
                          └───────────────────────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| **Gateway** | 4000 | GraphQL API + WebSocket subscriptions |
| **Bridge** | 3030 | Wallet management, transaction signing & submission |
| **Indexer** | 3031 | Webhook receiver, snapshot processing, DB indexing |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- Running OttoChain metagraph (local or remote)

### Development Setup

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Start Postgres
pnpm docker:up

# Push schema to database
pnpm db:push

# Start all services in dev mode
pnpm dev
```

### Using Docker Compose

```bash
# Start everything (Postgres + all services)
docker-compose up -d

# View logs
docker-compose logs -f gateway
docker-compose logs -f indexer
```

### Environment Variables

Create `.env` in the root:

```env
DATABASE_URL=postgresql://ottochain:ottochain@localhost:5432/ottochain_identity

# Metagraph endpoints
METAGRAPH_ML0_URL=http://localhost:9100
METAGRAPH_DL1_URL=http://localhost:9400

# Service ports
GATEWAY_PORT=4000
BRIDGE_PORT=3030
INDEXER_PORT=3031
```

## GraphQL API

The Gateway exposes a GraphQL API at `http://localhost:4000/graphql`.

### Example Queries

```graphql
# Get agent by address
query {
  agent(address: "DAG123...") {
    address
    displayName
    reputation
    state
    platformLinks {
      platform
      platformUserId
    }
  }
}

# Leaderboard
query {
  leaderboard(limit: 10) {
    address
    displayName
    reputation
  }
}

# Network stats
query {
  networkStats {
    totalAgents
    activeAgents
    totalContracts
    completedContracts
    lastSnapshotOrdinal
  }
}
```

### Subscriptions

```graphql
# Watch for new activity
subscription {
  activityFeed {
    eventType
    timestamp
    agent {
      displayName
    }
    action
    reputationDelta
  }
}
```

## Webhook Integration

The Indexer receives push notifications from ML0 when snapshots are finalized.

### Register with Metagraph

```bash
curl -X POST http://localhost:9100/data-application/v1/webhooks/subscribe \
  -H "Content-Type: application/json" \
  -d '{"callbackUrl": "http://localhost:3031/webhook/snapshot"}'
```

### Webhook Payload

```json
{
  "event": "snapshot.finalized",
  "ordinal": 12345,
  "hash": "abc123...",
  "timestamp": "2026-02-03T21:30:00.000Z",
  "stats": {
    "updatesProcessed": 42,
    "stateMachinesActive": 156
  }
}
```

## Development

### Project Structure

```
ottochain-services/
├── packages/
│   ├── gateway/        # Apollo GraphQL server
│   ├── bridge/         # Transaction signing
│   ├── indexer/        # Snapshot processor
│   └── shared/         # Common types, DB client
├── prisma/
│   └── schema.prisma   # Database schema
├── docker-compose.yml
└── package.json
```

### Commands

```bash
pnpm build          # Build all packages
pnpm dev            # Start all in dev mode
pnpm lint           # Lint all packages
pnpm test           # Run tests
pnpm db:studio      # Open Prisma Studio
pnpm db:migrate     # Run migrations
```

## Deployment

### Hetzner Beta

See [deployment guide](docs/deployment.md) for production setup with:
- Kubernetes manifests
- Helm chart
- Monitoring dashboards

## Related Repositories

- [ottochain](https://github.com/scasplte2/ottochain) — Metagraph (Scala)
- [ottochain-sdk](https://github.com/ottobot-ai/ottochain-sdk) — TypeScript SDK
- [identity-landing](https://github.com/ottobot-ai/identity-landing) — Explorer UI

## License

Apache-2.0
