/**
 * OttoChain Stack Monitor
 * 
 * Monitors the health of all metagraph nodes and services,
 * provides REST API and WebSocket for real-time dashboard updates.
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import type { StackHealth, ServiceStatus, MonitorConfig } from './types.js';
import { HealthCollector } from './collector.js';
import { MonitorCache } from './cache.js';
import { CacheRefresher } from './refresher.js';

// =============================================================================
// Alerting (Telegram + Webhook)
// =============================================================================

async function sendTelegramAlert(message: string, severity: 'warning' | 'critical'): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    return; // Telegram not configured
  }
  
  try {
    const emoji = severity === 'critical' ? '🚨' : '⚠️';
    const text = `${emoji} *OttoChain Monitor*\n\n${message}`;
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err);
  }
}

async function sendWebhookAlert(message: string, severity: 'warning' | 'critical'): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const webhookSecret = process.env.ALERT_WEBHOOK_SECRET;
  
  if (!webhookUrl) {
    return; // Webhook not configured
  }
  
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (webhookSecret) {
      headers['Authorization'] = `Bearer ${webhookSecret}`;
    }
    
    await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'ottochain-monitor',
        severity,
        message,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('Failed to send webhook alert:', err);
  }
}

async function sendAlert(message: string, severity: 'warning' | 'critical'): Promise<void> {
  console.log(`[ALERT ${severity.toUpperCase()}] ${message}`);
  
  // Send to all configured channels in parallel
  await Promise.all([
    sendTelegramAlert(message, severity),
    sendWebhookAlert(message, severity),
  ]);
}

// =============================================================================
// Authentication
// =============================================================================

interface AuthConfig {
  enabled: boolean;
  username: string;
  password: string;
}

function setupAuth(): AuthConfig {
  const username = process.env.MONITOR_USER ?? 'admin';
  const password = process.env.MONITOR_PASS ?? crypto.randomBytes(8).toString('base64').slice(0, 12);
  const enabled = process.env.MONITOR_AUTH !== 'false'; // Enabled by default
  
  return { enabled, username, password };
}

function basicAuthMiddleware(auth: AuthConfig) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!auth.enabled) return next();
    
    // Allow health endpoint without auth
    if (req.path === '/health') return next();
    
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="OttoChain Monitor"');
      return res.status(401).send('Authentication required');
    }
    
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [user, pass] = credentials.split(':');
    
    if (user === auth.username && pass === auth.password) {
      return next();
    }
    
    res.setHeader('WWW-Authenticate', 'Basic realm="OttoChain Monitor"');
    return res.status(401).send('Invalid credentials');
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Configuration
// =============================================================================

function loadConfig(): MonitorConfig {
  return {
    // Metagraph nodes (comma-separated URLs)
    gl0Urls: (process.env.GL0_URLS ?? 'http://localhost:9000').split(',').filter(Boolean),
    ml0Urls: (process.env.ML0_URLS ?? 'http://localhost:9200').split(',').filter(Boolean),
    cl1Urls: (process.env.CL1_URLS ?? '').split(',').filter(Boolean),
    dl1Urls: (process.env.DL1_URLS ?? 'http://localhost:9400,http://localhost:9410,http://localhost:9420').split(',').filter(Boolean),
    
    // Services
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
    indexerUrl: process.env.INDEXER_URL,
    gatewayUrl: process.env.GATEWAY_URL,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    postgresUrl: process.env.DATABASE_URL,
    
    // Polling
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
    timeoutMs: parseInt(process.env.TIMEOUT_MS ?? '3000', 10),
    
    // Server
    port: parseInt(process.env.MONITOR_PORT ?? '3032', 10),
    
    // Cache
    cacheEnabled: process.env.CACHE_ENABLED !== 'false', // enabled by default
    healthTTL: parseInt(process.env.CACHE_HEALTH_TTL ?? '10', 10),
    statusTTL: parseInt(process.env.CACHE_STATUS_TTL ?? '30', 10),
    metagraphTTL: parseInt(process.env.CACHE_METAGRAPH_TTL ?? '5', 10),
  };
}

// =============================================================================
// Server
// =============================================================================

function computeOverallStatus(nodes: { status: ServiceStatus }[], services: { status: ServiceStatus }[]): ServiceStatus {
  const all = [...nodes, ...services];
  const unhealthyCount = all.filter(s => s.status === 'unhealthy').length;
  const degradedCount = all.filter(s => s.status === 'degraded').length;
  
  if (unhealthyCount > all.length / 2) return 'unhealthy';
  if (unhealthyCount > 0 || degradedCount > 0) return 'degraded';
  return 'healthy';
}

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = setupAuth();
  const collector = new HealthCollector(config);
  
  // Set up alerting
  collector.setAlertCallback(sendAlert);
  
  // Initialize cache if enabled
  let cache: MonitorCache | null = null;
  let refresher: CacheRefresher | null = null;
  
  if (config.cacheEnabled && config.redisUrl) {
    try {
      cache = new MonitorCache({
        redisUrl: config.redisUrl,
        healthTTL: config.healthTTL,
        statusTTL: config.statusTTL,
        metagraphTTL: config.metagraphTTL,
      });
      
      // Test Redis connection
      const cacheHealthy = await cache.isHealthy();
      if (cacheHealthy) {
        refresher = new CacheRefresher(collector, cache);
        refresher.start();
        console.log('✅ Redis cache enabled');
      } else {
        console.warn('⚠️  Redis unhealthy, caching disabled');
        cache = null;
      }
    } catch (err) {
      console.warn('⚠️  Redis cache setup failed:', err);
      cache = null;
    }
  } else {
    console.log('ℹ️  Redis cache disabled');
  }
  
  console.log('🔍 OttoChain Stack Monitor');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`   GL0 nodes: ${config.gl0Urls.length}`);
  console.log(`   ML0 nodes: ${config.ml0Urls.length}`);
  console.log(`   CL1 nodes: ${config.cl1Urls.length}`);
  console.log(`   DL1 nodes: ${config.dl1Urls.length}`);
  console.log(`   Poll interval: ${config.pollIntervalMs}ms`);
  if (auth.enabled) {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('🔐 Authentication enabled');
    console.log(`   Username: ${auth.username}`);
    console.log(`   Password: ${auth.password}`);
    if (!process.env.MONITOR_PASS) {
      console.log('   (auto-generated, set MONITOR_PASS to use your own)');
    }
  }
  // Alerting config
  const hasWebhook = !!process.env.ALERT_WEBHOOK_URL;
  const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
  if (hasWebhook || hasTelegram) {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('🚨 Alerting configured:');
    if (hasWebhook) console.log('   ✓ Webhook: ' + process.env.ALERT_WEBHOOK_URL?.slice(0, 50) + '...');
    if (hasTelegram) console.log('   ✓ Telegram');
  }
  console.log('══════════════════════════════════════════════════════════════');
  
  // Express app
  const app = express();
  app.use(express.json());
  app.use(basicAuthMiddleware(auth));
  app.use(express.static(path.join(__dirname, '../public')));
  
  // REST endpoints with caching
  app.get('/health', async (_, res) => {
    // Build health response with component statuses
    const components: Record<string, 'ok' | 'degraded' | 'error'> = {};
    
    // Check Redis if enabled
    if (cache) {
      try {
        const redisHealthy = await cache.isHealthy();
        components.redis = redisHealthy ? 'ok' : 'error';
      } catch {
        components.redis = 'error';
      }
    }
    
    // Overall status based on components
    const hasError = Object.values(components).includes('error');
    const hasDegraded = Object.values(components).includes('degraded');
    const overallStatus = hasError ? 'degraded' : hasDegraded ? 'degraded' : 'ok';
    
    const healthResponse = {
      status: overallStatus,
      service: 'monitor',
      version: process.env.npm_package_version ?? '0.1.0',
      components: Object.keys(components).length > 0 ? components : undefined,
      timestamp: new Date().toISOString(),
    };
    
    // Set appropriate HTTP status
    const httpStatus = overallStatus === 'ok' ? 200 : 503;
    res.status(httpStatus).json(healthResponse);
  });
  
  app.get('/api/status', async (_, res) => {
    if (!cache) {
      const health = collector.getHealth();
      const response: StackHealth = {
        timestamp: Date.now(),
        overall: computeOverallStatus(health.nodes, health.services),
        nodes: health.nodes,
        services: health.services,
        metagraph: health.metagraph,
      };
      return res.json(response);
    }
    
    try {
      const result = await cache.getOrFetch(
        MonitorCache.keys.status,
        async () => {
          await collector.collect();
          const health = collector.getHealth();
          return {
            timestamp: Date.now(),
            overall: computeOverallStatus(health.nodes, health.services),
            nodes: health.nodes,
            services: health.services,
            metagraph: health.metagraph,
          };
        },
        cache.getTTL('status')
      );
      
      res.set('X-Cache', result.fromCache ? 'HIT' : 'MISS');
      if (result.ttlRemaining !== undefined) {
        res.set('X-Cache-TTL', result.ttlRemaining.toString());
      }
      res.json(result.data);
    } catch (err) {
      console.error('Status endpoint error:', err);
      const health = collector.getHealth();
      res.json({
        timestamp: Date.now(),
        overall: computeOverallStatus(health.nodes, health.services),
        nodes: health.nodes,
        services: health.services,
        metagraph: health.metagraph,
      });
    }
  });
  
  app.get('/api/nodes', async (_, res) => {
    if (!cache) {
      return res.json(collector.getHealth().nodes);
    }
    
    try {
      const result = await cache.getOrFetch(
        MonitorCache.keys.nodes,
        async () => {
          await collector.collect();
          return collector.getHealth().nodes;
        },
        cache.getTTL('status')
      );
      
      res.set('X-Cache', result.fromCache ? 'HIT' : 'MISS');
      if (result.ttlRemaining !== undefined) {
        res.set('X-Cache-TTL', result.ttlRemaining.toString());
      }
      res.json(result.data);
    } catch (err) {
      console.error('Nodes endpoint error:', err);
      res.json(collector.getHealth().nodes);
    }
  });
  
  app.get('/api/services', async (_, res) => {
    if (!cache) {
      return res.json(collector.getHealth().services);
    }
    
    try {
      const result = await cache.getOrFetch(
        MonitorCache.keys.services,
        async () => {
          await collector.collect();
          return collector.getHealth().services;
        },
        cache.getTTL('status')
      );
      
      res.set('X-Cache', result.fromCache ? 'HIT' : 'MISS');
      if (result.ttlRemaining !== undefined) {
        res.set('X-Cache-TTL', result.ttlRemaining.toString());
      }
      res.json(result.data);
    } catch (err) {
      console.error('Services endpoint error:', err);
      res.json(collector.getHealth().services);
    }
  });
  
  app.get('/api/metagraph', async (_, res) => {
    if (!cache) {
      return res.json(collector.getHealth().metagraph);
    }
    
    try {
      const result = await cache.getOrFetch(
        MonitorCache.keys.metagraph,
        async () => {
          await collector.collect();
          return collector.getHealth().metagraph;
        },
        cache.getTTL('metagraph')
      );
      
      res.set('X-Cache', result.fromCache ? 'HIT' : 'MISS');
      if (result.ttlRemaining !== undefined) {
        res.set('X-Cache-TTL', result.ttlRemaining.toString());
      }
      res.json(result.data);
    } catch (err) {
      console.error('Metagraph endpoint error:', err);
      res.json(collector.getHealth().metagraph);
    }
  });
  
  // Cache status and control endpoint
  app.get('/api/cache', async (_, res) => {
    if (!cache || !refresher) {
      return res.json({ 
        enabled: false, 
        status: 'disabled',
        message: 'Cache not configured' 
      });
    }
    
    try {
      const isHealthy = await cache.isHealthy();
      const refreshStatus = refresher.getStatus();
      
      res.json({
        enabled: config.cacheEnabled,
        status: isHealthy ? 'healthy' : 'unhealthy',
        redis: {
          url: config.redisUrl,
          healthy: isHealthy,
        },
        refresher: refreshStatus,
        ttl: {
          health: config.healthTTL,
          status: config.statusTTL,
          metagraph: config.metagraphTTL,
        },
      });
    } catch (err) {
      res.json({
        enabled: true,
        status: 'error',
        error: String(err),
      });
    }
  });
  
  // HTTP server
  const server = createServer(app);
  
  // Generate a session token for WebSocket auth (simpler than basic auth for WS)
  const wsToken = crypto.randomBytes(16).toString('hex');
  
  // Endpoint to get WS token (requires basic auth)
  app.get('/api/ws-token', (_, res) => {
    res.json({ token: wsToken });
  });
  
  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ 
    server, 
    path: '/ws',
    verifyClient: (info, callback) => {
      if (!auth.enabled) return callback(true);
      
      // Check for token in query string: /ws?token=xxx
      const url = new URL(info.req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      
      if (token === wsToken) {
        return callback(true);
      }
      
      callback(false, 401, 'Unauthorized - get token from /api/ws-token');
    }
  });
  const clients = new Set<WebSocket>();
  
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected (total: ${clients.size})`);
    
    // Send current state immediately
    const health = collector.getHealth();
    ws.send(JSON.stringify({
      type: 'status',
      data: {
        timestamp: Date.now(),
        overall: computeOverallStatus(health.nodes, health.services),
        nodes: health.nodes,
        services: health.services,
        metagraph: health.metagraph,
      },
    }));
    
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected (total: ${clients.size})`);
    });
  });
  
  // Broadcast to all clients
  function broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  
  // Start polling
  async function poll(): Promise<void> {
    await collector.collect();
    const health = collector.getHealth();
    
    // Log summary
    const healthyNodes = health.nodes.filter(n => n.status === 'healthy').length;
    const healthyServices = health.services.filter(s => s.status === 'healthy').length;
    const overall = computeOverallStatus(health.nodes, health.services);
    const icon = overall === 'healthy' ? '✅' : overall === 'degraded' ? '⚠️' : '❌';
    
    console.log(`${icon} [${new Date().toISOString()}] Nodes: ${healthyNodes}/${health.nodes.length} | Services: ${healthyServices}/${health.services.length} | Ordinal: ${health.metagraph.snapshotOrdinal ?? '-'} | Fibers: ${health.metagraph.fiberCount ?? '-'}`);
    
    // Broadcast to WebSocket clients
    broadcast({
      type: 'status',
      data: {
        timestamp: Date.now(),
        overall,
        nodes: health.nodes,
        services: health.services,
        metagraph: health.metagraph,
      },
    });
  }
  
  // Initial poll
  await poll();
  
  // Start interval
  setInterval(poll, config.pollIntervalMs);
  
  // Start server
  server.listen(config.port, () => {
    console.log(`\n🌐 Monitor UI:  http://localhost:${config.port}`);
    console.log(`📡 REST API:   http://localhost:${config.port}/api/status`);
    console.log(`🔌 WebSocket:  ws://localhost:${config.port}/ws`);
    if (cache) {
      console.log(`💾 Cache:      Redis (${config.healthTTL}s/${config.statusTTL}s/${config.metagraphTTL}s TTLs)`);
    }
  });
  
  // Cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    refresher?.stop();
    await cache?.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    refresher?.stop();
    await cache?.close();
    process.exit(0);
  });
}

main().catch(console.error);
