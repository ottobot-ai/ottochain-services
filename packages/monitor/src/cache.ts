/**
 * Redis cache service for monitor APIs
 * 
 * Provides caching layer to improve response times from 5+ seconds to <100ms
 * by caching expensive node health checks and metagraph data.
 */

import { Redis } from 'ioredis';
import type { StackHealth, NodeHealth, ServiceHealth, MetagraphMetrics } from './types.js';

export interface CacheConfig {
  redisUrl: string;
  healthTTL: number;    // 10 seconds - node status changes slowly
  statusTTL: number;    // 30 seconds - fiber counts update gradually  
  metagraphTTL: number; // 5 seconds - needs freshness for monitoring
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export class MonitorCache {
  private redis: Redis;
  private config: CacheConfig;
  
  constructor(config: CacheConfig) {
    this.config = config;
    this.redis = new Redis(config.redisUrl);
    
    this.redis.on('error', (err: Error) => {
      console.warn('Redis cache error:', err.message);
    });
  }

  /**
   * Get cached data by key
   */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;
      
      return JSON.parse(cached) as CacheEntry<T>;
    } catch (err) {
      console.warn(`Cache get error for key ${key}:`, err);
      return null;
    }
  }

  /**
   * Set cached data with TTL
   */
  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        cachedAt: Date.now(),
        expiresAt: Date.now() + (ttlSeconds * 1000),
      };
      
      await this.redis.setex(key, ttlSeconds, JSON.stringify(entry));
    } catch (err) {
      console.warn(`Cache set error for key ${key}:`, err);
    }
  }

  /**
   * Get from cache or fetch fresh data
   */
  async getOrFetch<T>(
    key: string, 
    fetcher: () => Promise<T>, 
    ttlSeconds: number
  ): Promise<{ data: T; fromCache: boolean; ttlRemaining?: number }> {
    const cached = await this.get<T>(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      const ttlRemaining = Math.round((cached.expiresAt - Date.now()) / 1000);
      return { 
        data: cached.data, 
        fromCache: true, 
        ttlRemaining 
      };
    }
    
    // Cache miss or expired - fetch fresh data
    try {
      const freshData = await fetcher();
      await this.set(key, freshData, ttlSeconds);
      return { data: freshData, fromCache: false };
    } catch (err) {
      // If fetch fails but we have stale cache, return it
      if (cached) {
        console.warn(`Fetch failed for ${key}, returning stale cache:`, err);
        return { data: cached.data, fromCache: true, ttlRemaining: 0 };
      }
      throw err;
    }
  }

  /**
   * Cache keys for different endpoints
   */
  static keys = {
    health: 'monitor:health',
    status: 'monitor:status', 
    nodes: 'monitor:nodes',
    services: 'monitor:services',
    metagraph: 'monitor:metagraph',
    syncStatus: 'monitor:sync-status',
  } as const;

  /**
   * Get cache configuration for different data types
   */
  getTTL(dataType: 'health' | 'status' | 'metagraph'): number {
    switch (dataType) {
      case 'health': return this.config.healthTTL;
      case 'status': return this.config.statusTTL;
      case 'metagraph': return this.config.metagraphTTL;
      default: return this.config.statusTTL;
    }
  }

  /**
   * Invalidate specific cache key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      console.warn(`Cache invalidation error for key ${key}:`, err);
    }
  }

  /**
   * Invalidate all monitor cache keys
   */
  async invalidateAll(): Promise<void> {
    const keys = Object.values(MonitorCache.keys);
    await Promise.all(keys.map(key => this.invalidate(key)));
  }

  /**
   * Health check for cache connection
   */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}