/**
 * Simple HTTP status server for traffic generator v2
 * Exposes current configuration and runtime stats for monitoring
 * Provides control endpoints to configure the generator
 * 
 * Endpoints:
 *   GET  /health           - Health check
 *   GET  /status           - Current status (active fibers, completion rate, etc.)
 *   GET  /weights          - Configured fiber type weights
 *   POST /weights          - Update fiber type weights at runtime
 *   GET  /fibers           - Active + recently completed fibers
 *   GET  /agents           - Agent pool registration status
 *   POST /start            - Start the generator
 *   POST /stop             - Stop the generator
 */

import * as http from 'node:http';

/**
 * v2 status - no GA-specific fields (generation, mutation, etc.)
 * Uses fiber-centric metrics instead of population-centric.
 */
export interface TrafficGenStatus {
  enabled: boolean;
  mode: 'orchestrator' | 'idle';
  /** Configured target concurrent active fibers */
  targetActiveFibers: number;
  /** Current active fiber count */
  activeFibers: number;
  /** Total fibers completed since startup */
  completedFibers: number;
  /** Total fibers failed since startup */
  failedFibers: number;
  /** Completion rate (completed / (completed + failed)) */
  successRate: number;
  /** Distribution of active fibers by type */
  fiberTypeDistribution: Record<string, number>;
  /** Milliseconds since startup */
  uptime: number;
  /** ISO timestamp when generator started */
  startedAt: string | null;
}

export interface TrafficGenConfig {
  targetActiveFibers?: number;
}

type StatusProvider = () => TrafficGenStatus;
type ControlCallback = () => Promise<void> | void;
type ConfigCallback = (config: TrafficGenConfig) => Promise<void> | void;
type WeightsProvider = () => Record<string, number>;
type WeightsUpdateCallback = (weights: Record<string, number>) => void;
/** Runtime view of an active fiber exposed by the status server */
export interface ActiveFiberStatus {
  id: string;
  type: string;
  currentState: string;
  participants: string[];
  startedAt: number;
  pending: boolean;
}

/** Completed fiber entry exposed by the status server */
export interface CompletedFiberStatus {
  id: string;
  type: string;
  finalState: string;
  completedAt: string;
}

export interface FibersResponse {
  active: ActiveFiberStatus[];
  completed: CompletedFiberStatus[];
  failed: number;
}

export interface AgentsResponse {
  registered: string[];
  count: number;
}

type FibersProvider = () => FibersResponse;
type AgentsProvider = () => AgentsResponse;

let statusProvider: StatusProvider = () => ({
  enabled: false,
  mode: 'idle',
  targetActiveFibers: 0,
  activeFibers: 0,
  completedFibers: 0,
  failedFibers: 0,
  successRate: 0,
  fiberTypeDistribution: {},
  uptime: 0,
  startedAt: null,
});

let onStart: ControlCallback | null = null;
let onStop: ControlCallback | null = null;
let onConfig: ConfigCallback | null = null;
let onWeightsUpdate: WeightsUpdateCallback | null = null;
let weightsProvider: WeightsProvider | null = null;
let fibersProvider: FibersProvider | null = null;
let agentsProvider: AgentsProvider | null = null;

let server: http.Server | null = null;

export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

export function setControlCallbacks(callbacks: {
  onStart?: ControlCallback;
  onStop?: ControlCallback;
  onConfig?: ConfigCallback;
  onWeightsUpdate?: WeightsUpdateCallback;
}): void {
  if (callbacks.onStart) onStart = callbacks.onStart;
  if (callbacks.onStop) onStop = callbacks.onStop;
  if (callbacks.onConfig) onConfig = callbacks.onConfig;
  if (callbacks.onWeightsUpdate) onWeightsUpdate = callbacks.onWeightsUpdate;
}

export function setWeightsProvider(provider: WeightsProvider): void {
  weightsProvider = provider;
}

export function setFibersProvider(provider: FibersProvider): void {
  fibersProvider = provider;
}

export function setAgentsProvider(provider: AgentsProvider): void {
  agentsProvider = provider;
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

      // GET /weights - Get current fiber weights
      if (req.url === '/weights' && req.method === 'GET') {
        if (!weightsProvider) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Weights provider not configured' }));
          return;
        }
        try {
          const weights = weightsProvider();
          res.writeHead(200);
          res.end(JSON.stringify(weights));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to get weights' }));
        }
        return;
      }

      // POST /weights - Update fiber weights
      if (req.url === '/weights' && req.method === 'POST') {
        if (!onWeightsUpdate) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Weights update not implemented' }));
          return;
        }
        try {
          const body = await parseBody(req) as Record<string, number>;
          onWeightsUpdate(body);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Weights updated', weights: body }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to update weights' }));
        }
        return;
      }

      // GET /fibers - Get active/completed fibers
      if (req.url === '/fibers' && req.method === 'GET') {
        if (!fibersProvider) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Fibers provider not configured' }));
          return;
        }
        try {
          const fibers = fibersProvider();
          res.writeHead(200);
          res.end(JSON.stringify(fibers));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to get fibers' }));
        }
        return;
      }

      // GET /agents - Get registered agents
      if (req.url === '/agents' && req.method === 'GET') {
        if (!agentsProvider) {
          res.writeHead(501);
          res.end(JSON.stringify({ error: 'Agents provider not configured' }));
          return;
        }
        try {
          const agents = agentsProvider();
          res.writeHead(200);
          res.end(JSON.stringify(agents));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to get agents' }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', reject);
    server.listen(port, () => {
      console.log(`📊 Status server listening on port ${port}`);
      console.log(`   GET  /status  - Get current status`);
      console.log(`   POST /start   - Start traffic generation`);
      console.log(`   POST /stop    - Stop traffic generation`);
      console.log(`   POST /config  - Update configuration`);
      console.log(`   GET  /weights - Get fiber weights`);
      console.log(`   POST /weights - Update fiber weights`);
      console.log(`   GET  /fibers  - Get active/completed fibers`);
      console.log(`   GET  /agents  - Get registered agents`);
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
