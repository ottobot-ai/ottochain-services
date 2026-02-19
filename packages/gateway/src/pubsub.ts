import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';
import { getRedisOptions } from '@ottochain/shared';

const options = getRedisOptions();

export const pubsub = new RedisPubSub({
  publisher: new Redis(options),
  subscriber: new Redis(options),
});

export const CHANNELS = {
  STATS_UPDATED: 'stats:updated',
  ACTIVITY_FEED: 'activity:feed', 
  AGENT_UPDATED: 'agent:updated',
  CONTRACT_UPDATED: 'contract:updated',
  MARKET_UPDATED: 'market:updated',
};
