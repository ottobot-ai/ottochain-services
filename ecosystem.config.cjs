/**
 * PM2 Ecosystem Configuration
 * 
 * Environment variables are loaded from .env file or system environment.
 * See .env.example for required variables.
 */

const requiredEnv = [
  'DATABASE_URL',
  'METAGRAPH_ML0_URL', 
  'METAGRAPH_DL1_URL',
];

// Validate required env vars
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`Warning: ${key} not set`);
  }
}

const sharedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  METAGRAPH_ML0_URL: process.env.METAGRAPH_ML0_URL,
  METAGRAPH_DL1_URL: process.env.METAGRAPH_DL1_URL,
  GL0_URL: process.env.GL0_URL,
  GL1_URL: process.env.GL1_URL,
  ML0_URL: process.env.ML0_URL,
  CL1_URL: process.env.CL1_URL,
  DL1_URL: process.env.DL1_URL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
};

module.exports = {
  apps: [
    {
      name: 'gateway',
      script: 'packages/gateway/dist/index.js',
      cwd: '/opt/ottochain-services',
      env: sharedEnv,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'indexer',
      script: 'packages/indexer/dist/index.js',
      cwd: '/opt/ottochain-services',
      env: sharedEnv,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'bridge',
      script: 'packages/bridge/dist/index.js',
      cwd: '/opt/ottochain-services',
      env: sharedEnv,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'traffic-gen',
      script: 'packages/traffic-generator/dist/index.js',
      cwd: '/opt/ottochain-services',
      env: sharedEnv,
      max_memory_restart: '256M',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'monitor',
      script: 'packages/monitor/dist/index.js',
      cwd: '/opt/ottochain-services',
      env: {
        ...sharedEnv,
        GL0_URLS: process.env.GL0_URL,
        ML0_URLS: process.env.ML0_URL,
        CL1_URLS: process.env.CL1_URL,
        DL1_URLS: process.env.DL1_URL,
        BRIDGE_URL: 'http://localhost:3030',
        INDEXER_URL: 'http://localhost:3031',
        GATEWAY_URL: 'http://localhost:4000',
        POLL_INTERVAL_MS: '10000',
        MONITOR_PORT: '3032',
        MONITOR_AUTH: 'false',
      },
      max_memory_restart: '256M',
      exp_backoff_restart_delay: 100,
    },
  ],
};
