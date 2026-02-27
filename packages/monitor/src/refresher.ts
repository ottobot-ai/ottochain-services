/**
 * Background cache refresher
 * 
 * Runs every 5 seconds to proactively refresh cached data,
 * ensuring cache is always warm and API responses are fast.
 */

import type { HealthCollector } from './collector.js';
import { MonitorCache } from './cache.js';
import type { StackHealth, ServiceStatus, NodeHealth } from './types.js';

export class CacheRefresher {
  private collector: HealthCollector;
  private cache: MonitorCache;
  private intervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(collector: HealthCollector, cache: MonitorCache, intervalMs = 5000) {
    this.collector = collector;
    this.cache = cache;
    this.intervalMs = intervalMs;
  }

  /**
   * Start background refresh loop
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`🔄 Starting cache refresh every ${this.intervalMs}ms`);
    
    // Initial refresh
    this.refresh().catch(err => 
      console.error('Initial cache refresh failed:', err)
    );
    
    // Set up interval
    this.intervalId = setInterval(() => {
      this.refresh().catch(err => 
        console.error('Cache refresh failed:', err)
      );
    }, this.intervalMs);
  }

  /**
   * Stop background refresh
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('🛑 Cache refresh stopped');
  }

  /**
   * Perform cache refresh
   */
  private async refresh(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Collect fresh health data
      await this.collector.collect();
      const health = this.collector.getHealth();
      
      // Compute derived data
      const overallStatus = this.computeOverallStatus(health.nodes, health.services);
      const stackHealth: StackHealth = {
        timestamp: Date.now(),
        overall: overallStatus,
        nodes: health.nodes,
        services: health.services,
        metagraph: health.metagraph,
      };
      
      // Cache all endpoints in parallel
      await Promise.all([
        // Individual endpoints  
        this.cache.set(
          MonitorCache.keys.nodes, 
          health.nodes, 
          this.cache.getTTL('status')
        ),
        this.cache.set(
          MonitorCache.keys.services, 
          health.services, 
          this.cache.getTTL('status')
        ),
        this.cache.set(
          MonitorCache.keys.metagraph, 
          health.metagraph, 
          this.cache.getTTL('metagraph')
        ),
        // Composite endpoints
        this.cache.set(
          MonitorCache.keys.status, 
          stackHealth, 
          this.cache.getTTL('status')
        ),
        this.cache.set(
          MonitorCache.keys.health, 
          { status: 'ok', service: 'monitor' }, 
          this.cache.getTTL('health')
        ),
        // Watchdog-consumable snapshot (flat format, no CacheEntry wrapper)
        this.writeWatchdogHealth(health.nodes),
      ]);
      
      const duration = Date.now() - startTime;
      const cacheHealthy = await this.cache.isHealthy();
      
      console.log(`🔄 Cache refreshed in ${duration}ms (Redis: ${cacheHealthy ? '✅' : '❌'})`);
      
    } catch (err) {
      console.error('Cache refresh failed:', err);
    }
  }

  /**
   * Write health snapshot in watchdog-consumable format.
   * 
   * The watchdog (ottochain-watchdog) reads `monitor:health:latest` as a flat
   * JSON blob — no CacheEntry wrapper. Groups node data by IP with per-layer status.
   * Written with 30s TTL; watchdog considers data stale after 60s (configurable).
   */
  private async writeWatchdogHealth(nodes: NodeHealth[]): Promise<void> {
    // Group nodes by IP (nodes array has one entry per node-layer combo)
    const byIp = new Map<string, { name: string; layers: Array<{
      layer: string; state: string; ordinal: number; reachable: boolean; clusterSize: number;
    }> }>();

    for (const node of nodes) {
      const ip = this.extractIp(node.url);
      if (!ip) continue;

      if (!byIp.has(ip)) {
        byIp.set(ip, { name: node.name.split('-')[0] ?? node.name, layers: [] });
      }
      byIp.get(ip)!.layers.push({
        layer: node.type,
        state: node.state ?? (node.status === 'unhealthy' ? 'Unreachable' : 'Unknown'),
        ordinal: node.ordinal ?? -1,
        reachable: node.status !== 'unhealthy',
        clusterSize: node.clusterSize ?? 0,
      });
    }

    const payload = {
      timestamp: new Date().toISOString(),
      nodes: Array.from(byIp.entries()).map(([ip, data]) => ({
        ip,
        name: data.name,
        layers: data.layers,
      })),
    };

    // Write raw (no CacheEntry wrapper) — watchdog reads plain JSON
    await this.cache.setRaw(MonitorCache.keys.watchdogHealth, payload, 30);
  }

  /** Extract IP from a node URL like http://10.0.0.1:9000 */
  private extractIp(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  /**
   * Compute overall status from nodes and services
   */
  private computeOverallStatus(
    nodes: { status: ServiceStatus }[], 
    services: { status: ServiceStatus }[]
  ): ServiceStatus {
    const all = [...nodes, ...services];
    const unhealthyCount = all.filter(s => s.status === 'unhealthy').length;
    const degradedCount = all.filter(s => s.status === 'degraded').length;
    
    if (unhealthyCount > all.length / 2) return 'unhealthy';
    if (unhealthyCount > 0 || degradedCount > 0) return 'degraded';
    return 'healthy';
  }

  /**
   * Get refresh status
   */
  getStatus() {
    return {
      running: this.isRunning,
      intervalMs: this.intervalMs,
    };
  }
}