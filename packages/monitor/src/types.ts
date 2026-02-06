/**
 * Monitor service types
 */

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface NodeHealth {
  name: string;
  type: 'gl0' | 'ml0' | 'cl1' | 'dl1';
  url: string;
  status: ServiceStatus;
  state?: string;
  version?: string;
  peerId?: string;
  clusterSize?: number;
  lastCheck: number;
  latencyMs?: number;
  error?: string;
  // Ordinal tracking
  ordinal?: number;
  ordinalLastChanged?: number;
  isProgressing?: boolean;
}

export interface MetagraphMetrics {
  snapshotOrdinal?: number;
  fiberCount?: number;
  lastSnapshotTime?: number;
  // Per-layer ordinals
  gl0Ordinal?: number;
  ml0Ordinal?: number;
  dl1Ordinal?: number;
  // Currency state
  currencySnapshotAvailable?: boolean;
  genesisWalletBalance?: string;
  // Sync health
  dl1Lag?: number;  // ML0 ordinal - DL1 cache ordinal
  isHealthy?: boolean;
}

export interface ServiceHealth {
  name: string;
  type: 'bridge' | 'indexer' | 'gateway' | 'redis' | 'postgres' | 'traffic-generator';
  url?: string;
  status: ServiceStatus;
  lastCheck: number;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface StackHealth {
  timestamp: number;
  overall: ServiceStatus;
  nodes: NodeHealth[];
  services: ServiceHealth[];
  metagraph: MetagraphMetrics;
}

export interface MonitorConfig {
  // Metagraph nodes
  gl0Urls: string[];
  ml0Urls: string[];
  cl1Urls: string[];
  dl1Urls: string[];
  
  // Services
  bridgeUrl?: string;
  indexerUrl?: string;
  gatewayUrl?: string;
  redisUrl?: string;
  postgresUrl?: string;
  
  // Polling
  pollIntervalMs: number;
  timeoutMs: number;
  
  // Server
  port: number;
}
