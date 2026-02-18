/**
 * Simple HTTP status server for traffic generator
 * Exposes current configuration and runtime stats for monitoring
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

type StatusProvider = () => TrafficGenStatus;

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

let server: http.Server | null = null;

export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

export function startStatusServer(port: number = 3033): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS headers for monitor
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.url === '/status') {
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

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', reject);
    server.listen(port, () => {
      console.log(`📊 Status server listening on port ${port}`);
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
