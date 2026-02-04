# Redis Pub/Sub Implementation Spec

## Goal
Add Redis-based pub/sub to enable real-time GraphQL subscriptions.

## Architecture
```
Indexer → Redis.publish() → Gateway (subscribes) → WebSocket → Explorer
```

## Tasks

### 1. Add Redis to docker-compose.yml
- Image: `redis:7-alpine`
- Port: 6379
- No persistence needed (ephemeral pub/sub)

### 2. Create shared Redis client module
File: `packages/shared/src/redis.ts`
```typescript
import Redis from 'ioredis';
import { getConfig } from './config.js';

const config = getConfig();

export const publisher = new Redis(config.REDIS_URL);
export const subscriber = new Redis(config.REDIS_URL);

// Event channels
export const CHANNELS = {
  STATS_UPDATED: 'stats:updated',
  ACTIVITY_FEED: 'activity:feed',
  AGENT_UPDATED: 'agent:updated',
  CONTRACT_UPDATED: 'contract:updated',
} as const;

// Publish helper
export async function publishEvent<T>(channel: string, data: T): Promise<void> {
  await publisher.publish(channel, JSON.stringify(data));
}
```

### 3. Update shared config
Add to `packages/shared/src/config.ts`:
```typescript
REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
```

### 4. Update Indexer to publish events
In `packages/indexer/src/processor.ts`, after database writes:
```typescript
import { publishEvent, CHANNELS } from '@ottochain/shared';

// After updating agent:
await publishEvent(CHANNELS.AGENT_UPDATED, { address, reputation, state });

// After creating attestation:
await publishEvent(CHANNELS.ACTIVITY_FEED, {
  eventType: 'ATTESTATION',
  timestamp: new Date().toISOString(),
  agent: { address, displayName },
  action: `Received ${type} attestation`,
  reputationDelta: delta,
});

// After processing snapshot:
await publishEvent(CHANNELS.STATS_UPDATED, stats);
```

### 5. Create Gateway PubSub service
File: `packages/gateway/src/pubsub.ts`
```typescript
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';
import { getConfig } from '@ottochain/shared';

const config = getConfig();

const options = {
  host: new URL(config.REDIS_URL).hostname,
  port: parseInt(new URL(config.REDIS_URL).port || '6379'),
};

export const pubsub = new RedisPubSub({
  publisher: new Redis(options),
  subscriber: new Redis(options),
});

export const CHANNELS = {
  STATS_UPDATED: 'stats:updated',
  ACTIVITY_FEED: 'activity:feed', 
  AGENT_UPDATED: 'agent:updated',
  CONTRACT_UPDATED: 'contract:updated',
};
```

### 6. Wire Gateway subscription resolvers
In `packages/gateway/src/resolvers.ts`, update Subscription:
```typescript
import { pubsub, CHANNELS } from './pubsub.js';

export const resolvers = {
  // ... existing Query and Mutation resolvers ...
  
  Subscription: {
    statsUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.STATS_UPDATED),
      resolve: (payload: any) => payload,
    },
    activityFeed: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.ACTIVITY_FEED),
      resolve: (payload: any) => payload,
    },
    agentUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.AGENT_UPDATED),
      resolve: (payload: any) => payload,
    },
    contractUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.CONTRACT_UPDATED),
      resolve: (payload: any) => payload,
    },
  },
};
```

## Dependencies to install
```bash
# In packages/shared
pnpm add ioredis

# In packages/gateway  
pnpm add graphql-redis-subscriptions ioredis
```

## Environment
Add to .env:
```
REDIS_URL=redis://localhost:6379
```
