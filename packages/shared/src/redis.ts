import Redis from 'ioredis';
import { getConfig } from './config.js';

// Lazy-loaded Redis connections - only connect when first accessed
// This prevents ECONNREFUSED errors for services that don't use Redis

let _publisher: Redis | null = null;
let _subscriber: Redis | null = null;

export function getPublisher(): Redis {
  if (!_publisher) {
    const config = getConfig();
    _publisher = new Redis(config.REDIS_URL);
    _publisher.on('error', (err) => {
      console.error('[Redis publisher]', err.message);
    });
  }
  return _publisher;
}

export function getSubscriber(): Redis {
  if (!_subscriber) {
    const config = getConfig();
    _subscriber = new Redis(config.REDIS_URL);
    _subscriber.on('error', (err) => {
      console.error('[Redis subscriber]', err.message);
    });
  }
  return _subscriber;
}

// Legacy exports for backwards compatibility (lazy via getter)
export const publisher = new Proxy({} as Redis, {
  get(_, prop) {
    return (getPublisher() as any)[prop];
  }
});

export const subscriber = new Proxy({} as Redis, {
  get(_, prop) {
    return (getSubscriber() as any)[prop];
  }
});

// Event channels
export const CHANNELS = {
  STATS_UPDATED: 'stats:updated',
  ACTIVITY_FEED: 'activity:feed',
  AGENT_UPDATED: 'agent:updated',
  CONTRACT_UPDATED: 'contract:updated',
} as const;

// Publish helper
export async function publishEvent<T>(channel: string, data: T): Promise<void> {
  await getPublisher().publish(channel, JSON.stringify(data));
}
