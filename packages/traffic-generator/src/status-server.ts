/**
 * Simple HTTP status server for traffic generator
 * Exposes current configuration and runtime stats for monitoring
 * Provides control endpoints to start/stop/configure the generator
 */

import * as http from 'node:http';

export interface TrafficGenStatus {
  enabled: boolean;
  mode: 'standard' | 'high-throughput' | 'orchestrator' | 'idle';
  targetTps: number;
  targetPopulation: number;
  currentPopulation: number;
  currentTps: number;
  generation: number;
  totalTransactions: number;
  successRate: number;
  uptime: number;
  startedAt: string | null;
}

export interface TrafficGenConfig {
  targetTps?: number;
  targetPopulation?: number;
  mode?: 'standard' | 'high-throughput';
}

type StatusProvider = () => TrafficGenStatus;
type ControlCallback = () => Promise<void> | void;
type ConfigCallback = (config: TrafficGenConfig) => Promise<void> | void;

let statusProvider: StatusProvider = () => ({
  enabled: false,
  mode: 'idle',
  targetTps: 0,
  targetPopulation: 0,
  currentPopulation: 0,
  currentTps: 0,
  generation: 0,
  totalTransactions: 0,
  successRate: 0,
  uptime: 0,
  startedAt: null,
});

let onStart: ControlCallback | null = null;
let onStop: ControlCallback | null = null;
let onConfig: ConfigCallback | null = null;

let server: http.Server | null = null;

export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

export function setControlCallbacks(callbacks: {
  onStart?: ControlCallback;
  onStop?: ControlCallback;
  onConfig?: ConfigCallback;
}): void {
  if (callbacks.onStart) onStart = callbacks.onStart;
  if (callbacks.onStop) onStop = callbacks.onStop;
  if (callbacks.onConfig) onConfig = callbacks.onConfig;
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function startStatusServer(port: number = 3033): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      // CORS headers for monitor
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET /health
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // GET /status
      if (req.url === '/status' && req.method === 'GET') {
        try {
          const status = statusProvider();
          res.writeHead(200);
          res.end(JSON.stringify(status));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to get status' }));
        }
        return;
      }

      // POST /start - Start traffic generation
      if (req.url === '/start' && req.method === 'POST') {
        if (!onStart) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Start not implemented' }));
          return;
        }
        try {
          await onStart();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Traffic generation started' }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to start' }));
        }
        return;
      }

      // POST /stop - Stop traffic generation
      if (req.url === '/stop' && req.method === 'POST') {
        if (!onStop) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Stop not implemented' }));
          return;
        }
        try {
          await onStop();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Traffic generation stopped' }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to stop' }));
        }
        return;
      }

      // POST /config - Update configuration
      if (req.url === '/config' && req.method === 'POST') {
        if (!onConfig) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Config not implemented' }));
          return;
        }
        try {
          const body = await parseBody(req) as TrafficGenConfig;
          await onConfig(body);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Configuration updated', config: body }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to update config' }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', reject);
    server.listen(port, () => {
      console.log(`📊 Status server listening on port ${port}`);
      console.log(`   GET  /status - Get current status`);
      console.log(`   POST /start  - Start traffic generation`);
      console.log(`   POST /stop   - Stop traffic generation`);
      console.log(`   POST /config - Update configuration`);
      resolve();
    });
  });
}

export function stopStatusServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}
