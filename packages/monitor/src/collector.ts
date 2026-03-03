/**
 * Health data collector - polls metagraph nodes and services
 */

import { Redis } from 'ioredis';
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

// Track ordinal history for progression detection
const ordinalHistory: Map<string, { ordinal: number; timestamp: number }> = new Map();
const STALL_THRESHOLD_MS = 4 * 60 * 1000; // 4 minutes

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
    
    // Get ordinal based on layer type
    let ordinal: number | undefined;
    try {
      const ordinalEndpoint = type === 'gl0' ? '/global-snapshots/latest' : '/snapshots/latest';
      const ordRes = await fetchWithTimeout(`${url}${ordinalEndpoint}`, timeoutMs);
      if (ordRes.ok) {
        const ordData = await ordRes.json() as { value?: { ordinal?: number }; ordinal?: number };
        ordinal = ordData.value?.ordinal ?? ordData.ordinal;
      }
    } catch {
      // Ordinal check optional
    }
    
    // Check ordinal progression
    const historyKey = `${type}-${name}`;
    const prev = ordinalHistory.get(historyKey);
    const now = Date.now();
    let ordinalLastChanged = prev?.timestamp;
    let isProgressing = true;
    
    if (ordinal !== undefined) {
      if (prev && prev.ordinal !== ordinal) {
        // Ordinal changed - update timestamp
        ordinalHistory.set(historyKey, { ordinal, timestamp: now });
        ordinalLastChanged = now;
      } else if (prev && prev.ordinal === ordinal) {
        // Ordinal unchanged - check if stalled
        ordinalLastChanged = prev.timestamp;
        if (now - prev.timestamp > STALL_THRESHOLD_MS) {
          isProgressing = false;
        }
      } else {
        // First time seeing this node
        ordinalHistory.set(historyKey, { ordinal, timestamp: now });
        ordinalLastChanged = now;
      }
    }
    
    // Status considers both state AND progression
    let status: ServiceStatus = info.state === 'Ready' ? 'healthy' : 
                                info.state === 'Observing' ? 'degraded' : 'unhealthy';
    
    // Degrade status if stalled
    if (status === 'healthy' && !isProgressing) {
      status = 'degraded';
    }
    
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
      ordinal,
      ordinalLastChanged,
      isProgressing,
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
  const startTime = Date.now();
  
  const redis = new Redis(url, {
    connectTimeout: timeoutMs,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry on health check
  });
  
  try {
    await redis.connect();
    const pong = await redis.ping();
    const latencyMs = Date.now() - startTime;
    
    // Get some basic info
    let metadata: Record<string, unknown> | undefined;
    try {
      const info = await redis.info('server');
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      if (versionMatch) {
        metadata = { version: versionMatch[1] };
      }
    } catch {
      // Info is optional
    }
    
    return {
      name: 'Redis',
      type: 'redis',
      url: url.replace(/\/\/:[^@]+@/, '//***@'), // Mask password if present
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      lastCheck: Date.now(),
      latencyMs,
      metadata,
    };
  } catch (err) {
    return {
      name: 'Redis',
      type: 'redis',
      url: url.replace(/\/\/:[^@]+@/, '//***@'),
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      redis.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

export async function checkPostgres(url: string, timeoutMs: number): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    // Import prisma from shared package
    const { prisma } = await import('@ottochain/shared');
    
    // Simple health check query with timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    );
    
    const queryPromise = prisma.$queryRaw`SELECT 1 as health`;
    
    await Promise.race([queryPromise, timeoutPromise]);
    
    const latencyMs = Date.now() - startTime;
    
    return {
      name: 'Postgres',
      type: 'postgres',
      url: url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
      status: 'healthy',
      lastCheck: Date.now(),
      latencyMs,
    };
  } catch (err) {
    return {
      name: 'Postgres',
      type: 'postgres', 
      url: url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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

export async function checkTrafficGen(url: string, timeoutMs: number): Promise<ServiceHealth & { trafficGen?: TrafficGenStatus }> {
  const startTime = Date.now();
  
  try {
    const res = await fetchWithTimeout(`${url}/status`, timeoutMs);
    const latencyMs = Date.now() - startTime;
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json() as TrafficGenStatus;
    
    // Traffic gen being disabled is a valid operational state, not degraded
    // Only report unhealthy if unreachable (caught by the catch block)
    return {
      name: 'Traffic Generator',
      type: 'traffic-generator',
      url,
      status: 'healthy',
      lastCheck: Date.now(),
      latencyMs,
      trafficGen: data,
    };
  } catch (err) {
    return {
      name: 'Traffic Generator',
      type: 'traffic-generator',
      url,
      status: 'unhealthy',
      lastCheck: Date.now(),
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Genesis wallet address (from key)
const GENESIS_WALLET = process.env.GENESIS_WALLET || 'DAG3yG9CRoYd4XF4PTBtLo95h8uiGNWYXXrASJGg';

export async function getMetagraphMetrics(
  ml0Url: string, 
  gl0Url: string | undefined,
  dl1Url: string | undefined,
  timeoutMs: number
): Promise<MetagraphMetrics> {
  const metrics: MetagraphMetrics = {};
  
  try {
    // Get ML0 snapshot ordinal
    const snapshotRes = await fetchWithTimeout(`${ml0Url}/snapshots/latest`, timeoutMs);
    if (snapshotRes.ok) {
      const data = await snapshotRes.json() as { value?: { ordinal?: number } };
      metrics.snapshotOrdinal = data.value?.ordinal;
      metrics.ml0Ordinal = data.value?.ordinal;
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
  
  // Get GL0 ordinal
  if (gl0Url) {
    try {
      const gl0Res = await fetchWithTimeout(`${gl0Url}/global-snapshots/latest`, timeoutMs);
      if (gl0Res.ok) {
        const data = await gl0Res.json() as { value?: { ordinal?: number } };
        metrics.gl0Ordinal = data.value?.ordinal;
      }
    } catch {
      // Optional
    }
  }
  
  // Get DL1 ordinal (for sync lag calculation)
  if (dl1Url) {
    try {
      const dl1Res = await fetchWithTimeout(`${dl1Url}/data/latest`, timeoutMs);
      if (dl1Res.ok) {
        const data = await dl1Res.json() as { ordinal?: number };
        metrics.dl1Ordinal = data.ordinal;
        
        // Calculate lag
        if (metrics.ml0Ordinal !== undefined && metrics.dl1Ordinal !== undefined) {
          metrics.dl1Lag = metrics.ml0Ordinal - metrics.dl1Ordinal;
        }
      }
    } catch {
      // DL1 may not have data yet
    }
  }
  
  // Check currency snapshot availability (genesis wallet balance on ML0)
  try {
    const balanceRes = await fetchWithTimeout(`${ml0Url}/currency/${GENESIS_WALLET}/balance`, timeoutMs);
    if (balanceRes.ok) {
      const data = await balanceRes.json() as { balance?: number; ordinal?: number };
      metrics.currencySnapshotAvailable = (data.ordinal ?? 0) > 0;
      metrics.genesisWalletBalance = data.balance?.toString();
    }
  } catch {
    metrics.currencySnapshotAvailable = false;
  }
  
  // Overall health assessment
  metrics.isHealthy = 
    (metrics.ml0Ordinal ?? 0) > 0 &&
    metrics.currencySnapshotAvailable === true &&
    (metrics.dl1Lag === undefined || metrics.dl1Lag < 100);
  
  return metrics;
}

export class HealthCollector {
  private config: MonitorConfig;
  private latestHealth: {
    nodes: NodeHealth[];
    services: ServiceHealth[];
    metagraph: MetagraphMetrics;
  } = { nodes: [], services: [], metagraph: {} };
  
  constructor(config: MonitorConfig) {
    this.config = config;
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
    
    if (this.config.trafficGenUrl) {
      services.push(await checkTrafficGen(this.config.trafficGenUrl, this.config.timeoutMs));
    }

    if (this.config.explorerUrl) {
      services.push(await checkExplorer(this.config.explorerUrl, this.config.timeoutMs));
    }

    if (this.config.prometheusUrl) {
      services.push(await checkPrometheus(this.config.prometheusUrl, this.config.timeoutMs));
    }

    if (this.config.alertmanagerUrl) {
      services.push(await checkAlertmanager(this.config.alertmanagerUrl, this.config.timeoutMs));
    }

    if (this.config.grafanaUrl) {
      services.push(await checkGrafana(this.config.grafanaUrl, this.config.timeoutMs));
    }

    if (this.config.lokiUrl) {
      services.push(await checkLoki(this.config.lokiUrl, this.config.timeoutMs));
    }
    
    // Metagraph metrics (use first healthy nodes of each type)
    const healthyMl0 = nodes.find(n => n.type === 'ml0' && n.status === 'healthy');
    const healthyGl0 = nodes.find(n => n.type === 'gl0' && n.status === 'healthy');
    const healthyDl1 = nodes.find(n => n.type === 'dl1' && n.status === 'healthy');
    
    const metagraph = healthyMl0 
      ? await getMetagraphMetrics(
          healthyMl0.url,
          healthyGl0?.url,
          healthyDl1?.url,
          this.config.timeoutMs
        )
      : {};
    
    this.latestHealth = { nodes, services, metagraph };
  }
  
  getHealth() {
    return this.latestHealth;
  }
}

// =============================================================================
// =============================================================================
// Observability Stack Checkers
// =============================================================================

type ServiceType = ServiceHealth['type'];

/**
 * Generic HTTP health check helper.
 * Reduces duplication across simple health endpoint checkers.
 */
async function checkHttpService(
  name: string,
  type: ServiceType,
  url: string,
  healthPath: string,
  timeoutMs: number,
): Promise<ServiceHealth> {
  const startTime = Date.now();
  const fullUrl = healthPath ? `${url}${healthPath}` : url;
  try {
    const res = await fetchWithTimeout(fullUrl, timeoutMs);
    const latencyMs = Date.now() - startTime;
    return {
      name,
      type,
      url,
      status: res.ok ? 'healthy' : 'degraded',
      lastCheck: startTime + latencyMs,
      latencyMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return {
      name,
      type,
      url,
      status: 'unhealthy',
      lastCheck: startTime + latencyMs,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const checkExplorer = (url: string, timeoutMs: number) =>
  checkHttpService('Explorer', 'explorer', url, '', timeoutMs);

export const checkPrometheus = (url: string, timeoutMs: number) =>
  checkHttpService('Prometheus', 'prometheus', url, '/-/healthy', timeoutMs);

export const checkAlertmanager = (url: string, timeoutMs: number) =>
  checkHttpService('Alertmanager', 'alertmanager', url, '/-/healthy', timeoutMs);

export const checkLoki = (url: string, timeoutMs: number) =>
  checkHttpService('Loki', 'loki', url, '/ready', timeoutMs);

/**
 * Grafana requires special handling — parses JSON body to check database status.
 */
export async function checkGrafana(url: string, timeoutMs: number): Promise<ServiceHealth> {
  const startTime = Date.now();
  try {
    const res = await fetchWithTimeout(`${url}/api/health`, timeoutMs);
    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      return {
        name: 'Grafana',
        type: 'grafana',
        url,
        status: 'degraded',
        lastCheck: startTime + latencyMs,
        latencyMs,
        error: `HTTP ${res.status}`,
      };
    }
    const data = await res.json() as { database?: string };
    const status = data.database === 'ok' ? 'healthy' : 'degraded';
    return {
      name: 'Grafana',
      type: 'grafana',
      url,
      status,
      lastCheck: startTime + latencyMs,
      latencyMs,
      ...(status === 'degraded' ? { error: `database: ${data.database ?? 'unknown'}` } : {}),
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return {
      name: 'Grafana',
      type: 'grafana',
      url,
      status: 'unhealthy',
      lastCheck: startTime + latencyMs,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
