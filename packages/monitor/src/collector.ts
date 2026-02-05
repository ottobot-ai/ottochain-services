/**
 * Health data collector - polls metagraph nodes and services
 */

import type { NodeHealth, ServiceHealth, MetagraphMetrics, ServiceStatus, MonitorConfig } from './types.js';

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkNode(
  name: string,
  type: NodeHealth['type'],
  url: string,
  timeoutMs: number
): Promise<NodeHealth> {
  const startTime = Date.now();
  
  try {
    // Check node info
    const infoRes = await fetchWithTimeout(`${url}/node/info`, timeoutMs);
    if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status}`);
    
    const info = await infoRes.json() as { state: string; id: string; version: string };
    const latencyMs = Date.now() - startTime;
    
    // Try to get cluster info
    let clusterSize: number | undefined;
    try {
      const clusterRes = await fetchWithTimeout(`${url}/cluster/info`, timeoutMs);
      if (clusterRes.ok) {
        const cluster = await clusterRes.json() as unknown[];
        clusterSize = cluster.length;
      }
    } catch {
      // Cluster info optional
    }
    
    const status: ServiceStatus = info.state === 'Ready' ? 'healthy' : 
                                  info.state === 'Observing' ? 'degraded' : 'unhealthy';
    
    return {
      name,
      type,
      url,
      status,
      state: info.state,
      version: info.version,
      peerId: info.id?.slice(0, 16),
      clusterSize,
      lastCheck: Date.now(),
      latencyMs,
    };
  } catch (err) {
    return {
      name,
      type,
      url,
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkBridge(url: string, timeoutMs: number): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    const res = await fetchWithTimeout(`${url}/health`, timeoutMs);
    const latencyMs = Date.now() - startTime;
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json() as { status: string };
    
    return {
      name: 'Bridge',
      type: 'bridge',
      url,
      status: data.status === 'ok' ? 'healthy' : 'degraded',
      lastCheck: Date.now(),
      latencyMs,
    };
  } catch (err) {
    return {
      name: 'Bridge',
      type: 'bridge',
      url,
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkIndexer(url: string, timeoutMs: number): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    const res = await fetchWithTimeout(`${url}/health`, timeoutMs);
    const latencyMs = Date.now() - startTime;
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json() as { status: string };
    
    return {
      name: 'Indexer',
      type: 'indexer',
      url,
      status: data.status === 'ok' ? 'healthy' : 'degraded',
      lastCheck: Date.now(),
      latencyMs,
    };
  } catch (err) {
    return {
      name: 'Indexer',
      type: 'indexer',
      url,
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkGateway(url: string, timeoutMs: number): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    const res = await fetchWithTimeout(`${url}/health`, timeoutMs);
    const latencyMs = Date.now() - startTime;
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json() as { status: string };
    
    return {
      name: 'Gateway',
      type: 'gateway',
      url,
      status: data.status === 'ok' ? 'healthy' : 'degraded',
      lastCheck: Date.now(),
      latencyMs,
    };
  } catch (err) {
    return {
      name: 'Gateway',
      type: 'gateway',
      url,
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkRedis(url: string, timeoutMs: number): Promise<ServiceHealth> {
  // For Redis, we'd need a Redis client. For now, mark as unknown if URL provided
  return {
    name: 'Redis',
    type: 'redis',
    url,
    status: 'unknown',
    lastCheck: Date.now(),
    metadata: { note: 'Redis health check requires client connection' },
  };
}

export async function checkPostgres(url: string, timeoutMs: number): Promise<ServiceHealth> {
  // For Postgres, we'd need a pg client. Mark as unknown for now.
  return {
    name: 'Postgres',
    type: 'postgres',
    url: url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Hide credentials
    status: 'unknown',
    lastCheck: Date.now(),
    metadata: { note: 'Postgres health check requires client connection' },
  };
}

export async function getMetagraphMetrics(ml0Url: string, timeoutMs: number): Promise<MetagraphMetrics> {
  const metrics: MetagraphMetrics = {};
  
  try {
    // Get snapshot ordinal
    const snapshotRes = await fetchWithTimeout(`${ml0Url}/snapshots/latest`, timeoutMs);
    if (snapshotRes.ok) {
      const data = await snapshotRes.json() as { value?: { ordinal?: number } };
      metrics.snapshotOrdinal = data.value?.ordinal;
    }
  } catch {
    // Optional
  }
  
  try {
    // Get fiber count from checkpoint
    const checkpointRes = await fetchWithTimeout(`${ml0Url}/data-application/v1/checkpoint`, timeoutMs);
    if (checkpointRes.ok) {
      const data = await checkpointRes.json() as { ordinal?: number; state?: { stateMachines?: Record<string, unknown> } };
      metrics.fiberCount = data.state?.stateMachines ? Object.keys(data.state.stateMachines).length : 0;
    }
  } catch {
    // Optional
  }
  
  return metrics;
}

export interface AlertCallback {
  (message: string, severity: 'warning' | 'critical'): void;
}

export class HealthCollector {
  private config: MonitorConfig;
  private latestHealth: {
    nodes: NodeHealth[];
    services: ServiceHealth[];
    metagraph: MetagraphMetrics;
  } = { nodes: [], services: [], metagraph: {} };
  private previousHealth: typeof this.latestHealth | null = null;
  private alertCallback: AlertCallback | null = null;
  private lastAlertTime: Record<string, number> = {};
  private alertCooldownMs = 60000; // Don't spam alerts - 1 min cooldown per issue
  
  constructor(config: MonitorConfig) {
    this.config = config;
  }
  
  setAlertCallback(callback: AlertCallback): void {
    this.alertCallback = callback;
  }
  
  private alert(key: string, message: string, severity: 'warning' | 'critical'): void {
    const now = Date.now();
    if (this.lastAlertTime[key] && now - this.lastAlertTime[key] < this.alertCooldownMs) {
      return; // Cooldown active
    }
    this.lastAlertTime[key] = now;
    this.alertCallback?.(message, severity);
  }
  
  private checkForAlerts(nodes: NodeHealth[]): void {
    // Check for node failures
    for (const node of nodes) {
      const prevNode = this.previousHealth?.nodes.find(n => n.name === node.name);
      
      // Node went down
      if (node.status === 'unhealthy' && prevNode?.status === 'healthy') {
        this.alert(`node-down-${node.name}`, `🔴 Node DOWN: ${node.name} (${node.url})`, 'critical');
      }
      
      // Node recovered
      if (node.status === 'healthy' && prevNode?.status === 'unhealthy') {
        this.alert(`node-up-${node.name}`, `🟢 Node RECOVERED: ${node.name}`, 'warning');
      }
    }
    
    // Check for forks (different ordinals/states between same-type nodes)
    this.checkForForks(nodes);
  }
  
  private checkForForks(nodes: NodeHealth[]): void {
    // Group by type
    const byType: Record<string, NodeHealth[]> = {};
    for (const node of nodes) {
      if (!byType[node.type]) byType[node.type] = [];
      byType[node.type].push(node);
    }
    
    // Check each group for state mismatches
    for (const [type, typeNodes] of Object.entries(byType)) {
      const healthyNodes = typeNodes.filter(n => n.status === 'healthy');
      if (healthyNodes.length < 2) continue;
      
      // Check if all healthy nodes have the same state
      const states = new Set(healthyNodes.map(n => n.state));
      if (states.size > 1) {
        this.alert(
          `fork-${type}`,
          `⚠️ Potential FORK in ${type.toUpperCase()}: Nodes have different states: ${Array.from(states).join(', ')}`,
          'critical'
        );
      }
    }
  }
  
  async collect(): Promise<void> {
    const nodePromises: Promise<NodeHealth>[] = [];
    
    // GL0 nodes
    this.config.gl0Urls.forEach((url, i) => {
      nodePromises.push(checkNode(`GL0-${i}`, 'gl0', url, this.config.timeoutMs));
    });
    
    // ML0 nodes
    this.config.ml0Urls.forEach((url, i) => {
      nodePromises.push(checkNode(`ML0-${i}`, 'ml0', url, this.config.timeoutMs));
    });
    
    // CL1 nodes
    this.config.cl1Urls.forEach((url, i) => {
      nodePromises.push(checkNode(`CL1-${i}`, 'cl1', url, this.config.timeoutMs));
    });
    
    // DL1 nodes
    this.config.dl1Urls.forEach((url, i) => {
      nodePromises.push(checkNode(`DL1-${i}`, 'dl1', url, this.config.timeoutMs));
    });
    
    const nodes = await Promise.all(nodePromises);
    
    // Services
    const services: ServiceHealth[] = [];
    
    if (this.config.bridgeUrl) {
      services.push(await checkBridge(this.config.bridgeUrl, this.config.timeoutMs));
    }
    
    if (this.config.indexerUrl) {
      services.push(await checkIndexer(this.config.indexerUrl, this.config.timeoutMs));
    }
    
    if (this.config.gatewayUrl) {
      services.push(await checkGateway(this.config.gatewayUrl, this.config.timeoutMs));
    }
    
    if (this.config.redisUrl) {
      services.push(await checkRedis(this.config.redisUrl, this.config.timeoutMs));
    }
    
    if (this.config.postgresUrl) {
      services.push(await checkPostgres(this.config.postgresUrl, this.config.timeoutMs));
    }
    
    // Metagraph metrics (use first healthy ML0)
    const healthyMl0 = nodes.find(n => n.type === 'ml0' && n.status === 'healthy');
    const metagraph = healthyMl0 
      ? await getMetagraphMetrics(healthyMl0.url, this.config.timeoutMs)
      : {};
    
    // Check for alerts before updating
    this.checkForAlerts(nodes);
    
    // Update state
    this.previousHealth = this.latestHealth;
    this.latestHealth = { nodes, services, metagraph };
  }
  
  getHealth() {
    return this.latestHealth;
  }
}
