// Shared configuration

import { z } from 'zod';

// Custom Redis URL validator (redis:// URLs may not pass standard URL validation)
const redisUrl = z.string().refine(
  (val) => {
    try {
      const url = new URL(val);
      return url.protocol === 'redis:' || url.protocol === 'rediss:';
    } catch {
      return false;
    }
  },
  { message: 'Invalid Redis URL (expected redis:// or rediss://)' }
);

const ConfigSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: redisUrl.default('redis://localhost:6379'),
  
  // Global L0 (for confirmation checking)
  GL0_URL: z.string().url().optional(),
  
  // Metagraph identification
  METAGRAPH_ID: z.string().optional(), // DAG address of the metagraph
  
  // Metagraph endpoints
  METAGRAPH_ML0_URL: z.string().url().default('http://localhost:9200'),
  METAGRAPH_DL1_URL: z.string().url().default('http://localhost:9400'),
  
  // Service ports
  GATEWAY_PORT: z.coerce.number().default(4000),
  BRIDGE_PORT: z.coerce.number().default(3030),
  BRIDGE_URL: z.string().url().default('http://localhost:3030'),
  INDEXER_PORT: z.coerce.number().default(3031),
  
  // GL0 polling interval (ms)
  GL0_POLL_INTERVAL: z.coerce.number().default(5000),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = ConfigSchema.parse(process.env);
  }
  return _config;
}

export function isProduction(): boolean {
  return getConfig().NODE_ENV === 'production';
}

/** Parse Redis URL into ioredis connection options */
export function getRedisOptions(): { host: string; port: number; tls?: object } {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 6379,
    ...(url.protocol === 'rediss:' && { tls: {} }),
  };
}
