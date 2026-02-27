/**
 * Prometheus metrics endpoint for the OttoChain monitor.
 * 
 * Exposes collector data as Prometheus gauges so Grafana can query
 * metagraph health alongside infrastructure metrics.
 */

import client from 'prom-client';
import type { NodeHealth, ServiceHealth, MetagraphMetrics } from './types.js';

// Use a custom registry so we don't pollute the global one
const registry = new client.Registry();

// Default process/nodejs metrics
client.collectDefaultMetrics({ register: registry, prefix: 'ottochain_monitor_' });

// ---------- Node health ----------

const nodeStatus = new client.Gauge({
  name: 'ottochain_node_healthy',
  help: '1 if node is healthy, 0 otherwise',
  labelNames: ['name', 'type', 'url'] as const,
  registers: [registry],
});

const nodeState = new client.Gauge({
  name: 'ottochain_node_ready',
  help: '1 if node state is Ready, 0 otherwise',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

const nodeLatency = new client.Gauge({
  name: 'ottochain_node_latency_ms',
  help: 'Last health check latency in milliseconds',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

const nodeClusterSize = new client.Gauge({
  name: 'ottochain_node_cluster_size',
  help: 'Number of peers in the node cluster',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

const nodeOrdinal = new client.Gauge({
  name: 'ottochain_node_ordinal',
  help: 'Latest ordinal reported by node',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

// ---------- Service health ----------

const serviceStatus = new client.Gauge({
  name: 'ottochain_service_healthy',
  help: '1 if service is healthy, 0 otherwise',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

const serviceLatency = new client.Gauge({
  name: 'ottochain_service_latency_ms',
  help: 'Last health check latency in milliseconds',
  labelNames: ['name', 'type'] as const,
  registers: [registry],
});

// ---------- Metagraph metrics ----------

const snapshotOrdinal = new client.Gauge({
  name: 'ottochain_metagraph_snapshot_ordinal',
  help: 'Latest metagraph snapshot ordinal',
  registers: [registry],
});

const fiberCount = new client.Gauge({
  name: 'ottochain_metagraph_fiber_count',
  help: 'Number of active fibers (state machines)',
  registers: [registry],
});

const dl1Lag = new client.Gauge({
  name: 'ottochain_metagraph_dl1_lag',
  help: 'DL1 ordinal lag behind ML0',
  registers: [registry],
});

const gl0Ordinal = new client.Gauge({
  name: 'ottochain_metagraph_gl0_ordinal',
  help: 'Global L0 ordinal',
  registers: [registry],
});

const overallHealthy = new client.Gauge({
  name: 'ottochain_overall_healthy',
  help: '1 if overall status is healthy, 0 otherwise',
  registers: [registry],
});

// ---------- Update function ----------

export function updateMetrics(
  nodes: NodeHealth[],
  services: ServiceHealth[],
  metagraph: MetagraphMetrics,
  overall: string,
): void {
  // Nodes
  for (const node of nodes) {
    const labels = { name: node.name, type: node.type };
    nodeStatus.set({ ...labels, url: node.url }, node.status === 'healthy' ? 1 : 0);
    nodeState.set(labels, node.state === 'Ready' ? 1 : 0);
    if (node.latencyMs !== undefined) nodeLatency.set(labels, node.latencyMs);
    if (node.clusterSize !== undefined) nodeClusterSize.set(labels, node.clusterSize);
    if (node.ordinal !== undefined) nodeOrdinal.set(labels, node.ordinal);
  }

  // Services
  for (const svc of services) {
    const labels = { name: svc.name, type: svc.type };
    serviceStatus.set(labels, svc.status === 'healthy' ? 1 : 0);
    if (svc.latencyMs !== undefined) serviceLatency.set(labels, svc.latencyMs);
  }

  // Metagraph
  if (metagraph.snapshotOrdinal !== undefined) snapshotOrdinal.set(metagraph.snapshotOrdinal);
  if (metagraph.fiberCount !== undefined) fiberCount.set(metagraph.fiberCount);
  if (metagraph.dl1Lag !== undefined) dl1Lag.set(metagraph.dl1Lag);
  if (metagraph.gl0Ordinal !== undefined) gl0Ordinal.set(metagraph.gl0Ordinal);

  // Overall
  overallHealthy.set(overall === 'healthy' ? 1 : 0);
}

// ---------- Express handler ----------

export async function metricsHandler(_req: express.Request, res: express.Response): Promise<void> {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}

// Need express types for the handler signature
import type express from 'express';

export { registry };
