// Shared configuration

import { z } from 'zod';

const ConfigSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // Metagraph endpoints
  METAGRAPH_ML0_URL: z.string().url().default('http://localhost:9100'),
  METAGRAPH_DL1_URL: z.string().url().default('http://localhost:9400'),
  
  // Service ports
  GATEWAY_PORT: z.coerce.number().default(4000),
  BRIDGE_PORT: z.coerce.number().default(3030),
  INDEXER_PORT: z.coerce.number().default(3031),
  
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
