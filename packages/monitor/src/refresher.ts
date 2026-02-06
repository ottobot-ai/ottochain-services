/**
 * Background cache refresher
 * 
 * Runs every 5 seconds to proactively refresh cached data,
 * ensuring cache is always warm and API responses are fast.
 */

import type { HealthCollector } from './collector.js';
import { MonitorCache } from './cache.js';
import type { StackHealth, ServiceStatus } from './types.js';

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
      ]);
      
      const duration = Date.now() - startTime;
      const cacheHealthy = await this.cache.isHealthy();
      
      console.log(`🔄 Cache refreshed in ${duration}ms (Redis: ${cacheHealthy ? '✅' : '❌'})`);
      
    } catch (err) {
      console.error('Cache refresh failed:', err);
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