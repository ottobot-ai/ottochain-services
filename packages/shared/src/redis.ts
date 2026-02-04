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
