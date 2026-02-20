import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';
import { getRedisOptions } from '@ottochain/shared';

const options = getRedisOptions();

export const pubsub = new RedisPubSub({
  publisher: new Redis(options),
  subscriber: new Redis(options),
});
