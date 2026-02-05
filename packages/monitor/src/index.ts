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
    redisUrl: process.env.REDIS_URL,
    postgresUrl: process.env.DATABASE_URL,
    
    // Polling
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
    timeoutMs: parseInt(process.env.TIMEOUT_MS ?? '3000', 10),
    
    // Server
    port: parseInt(process.env.MONITOR_PORT ?? '3032', 10),
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
  console.log('══════════════════════════════════════════════════════════════');
  
  // Express app
  const app = express();
  app.use(express.json());
  app.use(basicAuthMiddleware(auth));
  app.use(express.static(path.join(__dirname, '../public')));
  
  // REST endpoints
  app.get('/health', (_, res) => {
    res.json({ status: 'ok', service: 'monitor' });
  });
  
  app.get('/api/status', (_, res) => {
    const health = collector.getHealth();
    const response: StackHealth = {
      timestamp: Date.now(),
      overall: computeOverallStatus(health.nodes, health.services),
      nodes: health.nodes,
      services: health.services,
      metagraph: health.metagraph,
    };
    res.json(response);
  });
  
  app.get('/api/nodes', (_, res) => {
    res.json(collector.getHealth().nodes);
  });
  
  app.get('/api/services', (_, res) => {
    res.json(collector.getHealth().services);
  });
  
  app.get('/api/metagraph', (_, res) => {
    res.json(collector.getHealth().metagraph);
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
  });
}

main().catch(console.error);
