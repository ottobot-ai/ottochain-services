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
