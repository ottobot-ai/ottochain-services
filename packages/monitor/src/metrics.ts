/**
 * Prometheus metrics for OttoChain monitor.
 *
 * These metrics ADD information beyond what tessellation's own /metrics already
 * provide. Tessellation metrics (dag_*, jvm_*, process_*, etc.) are scraped
 * directly by Prometheus from the node ports — we don't re-export them here.
 *
 * Monitor-only metrics:
 *  - Node reachability as seen by the monitor (not the node itself)
 *  - Fiber count extracted from monitor health checks
 *  - Service health (bridge, indexer, gateway, etc.)
 *  - Monitor's own operational health (check freshness, duration)
 *  - Active alert count
 *  - Restart event counter
 */

import {
  Registry,
  Gauge,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import type { Request, Response } from 'express';
import type { StackHealth } from './types.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const registry = new Registry();

// Collect Node.js default metrics (process_*, nodejs_*) into our registry
collectDefaultMetrics({ register: registry, prefix: 'ottochain_monitor_nodejs_' });

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

/** When the monitor last completed a full health-check cycle (Unix seconds) */
export const lastCheckTimestamp = new Gauge({
  name: 'ottochain_monitor_last_check_timestamp',
  help: 'Unix timestamp (seconds) when the monitor last completed a health check cycle',
  registers: [registry],
});

/** How long each health-check collection cycle takes */
export const checkDurationSeconds = new Histogram({
  name: 'ottochain_monitor_check_duration_seconds',
  help: 'Duration in seconds of each monitor health-check cycle',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

/** 1 = healthy, 0 = unhealthy per node+layer */
export const nodeStatus = new Gauge({
  name: 'ottochain_node_status',
  help: '1 if the node is healthy from the monitor perspective, 0 otherwise',
  labelNames: ['node', 'layer'] as const,
  registers: [registry],
});

/** Current ordinal observed per node+layer via health check */
export const nodeOrdinal = new Gauge({
  name: 'ottochain_node_ordinal',
  help: 'Current snapshot ordinal observed per node and layer',
  labelNames: ['node', 'layer'] as const,
  registers: [registry],
});

/** Cluster peer count per node+layer */
export const nodeClusterSize = new Gauge({
  name: 'ottochain_node_cluster_size',
  help: 'Number of cluster peers seen per node and layer',
  labelNames: ['node', 'layer'] as const,
  registers: [registry],
});

/** Health-check round-trip latency per node+layer in milliseconds */
export const nodeLatencyMs = new Gauge({
  name: 'ottochain_node_latency_ms',
  help: 'Health check latency in milliseconds per node and layer',
  labelNames: ['node', 'layer'] as const,
  registers: [registry],
});

/** 1 = healthy, 0 = unhealthy per service */
export const serviceStatus = new Gauge({
  name: 'ottochain_service_status',
  help: '1 if the service is healthy, 0 otherwise',
  labelNames: ['service'] as const,
  registers: [registry],
});

/** Active fiber count from metagraph health */
export const metagraphFiberCount = new Gauge({
  name: 'ottochain_metagraph_fiber_count',
  help: 'Number of active fibers in the metagraph',
  registers: [registry],
});

/** Cumulative restart events (can only increase) */
export const restartsTotal = new Counter({
  name: 'ottochain_restarts_total',
  help: 'Total number of restart events observed by the monitor',
  labelNames: ['scope', 'condition'] as const,
  registers: [registry],
});

/** Number of currently active alerts */
export const activeAlerts = new Gauge({
  name: 'ottochain_active_alerts',
  help: 'Number of currently active alerts tracked by the monitor',
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Update helper
// ---------------------------------------------------------------------------

/**
 * Update all gauge metrics from the latest StackHealth snapshot.
 * Call this once per collection cycle.
 */
export function updateMetrics(health: StackHealth): void {
  lastCheckTimestamp.set(health.timestamp / 1000); // ms → seconds

  // Per-node metrics
  for (const node of health.nodes) {
    const labels = { node: node.url, layer: node.type };

    nodeStatus.set(labels, node.status === 'healthy' ? 1 : 0);

    if (node.latencyMs !== undefined) {
      nodeLatencyMs.set(labels, node.latencyMs);
    }

    if (node.clusterSize !== undefined) {
      nodeClusterSize.set(labels, node.clusterSize);
    }

    // Ordinal: prefer the per-node ordinal field if present
    const ordinal = node.ordinal;
    if (ordinal !== undefined) {
      nodeOrdinal.set(labels, ordinal);
    }
  }

  // Per-service metrics
  for (const svc of health.services) {
    serviceStatus.set({ service: svc.name }, svc.status === 'healthy' ? 1 : 0);
  }

  // Metagraph aggregates
  if (health.metagraph.fiberCount !== undefined) {
    metagraphFiberCount.set(health.metagraph.fiberCount);
  }
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/**
 * Prometheus text-format middleware.
 * Mount as: app.get('/metrics', metricsMiddleware)
 */
export async function metricsMiddleware(_req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
}
