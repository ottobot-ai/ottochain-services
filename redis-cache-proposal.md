# Redis Cache Implementation Proposal

## Problem Statement

Monitor APIs are **slow (5+ seconds)** because each request triggers ~12+ HTTP calls:

| Expensive Operation | Count | Purpose |
|---------------------|-------|---------|
| Node health checks | 4 calls | `/node/info` on GL0, ML0, CL1, DL1 |
| Service health checks | 4 calls | `/health` on Gateway, Bridge, Indexer, Monitor |
| Ordinal fetching | 1 call | `/snapshots/latest` from ML0 |
| State machine count | 1 call | `/data-application/v1/state-machines` |
| **Total per request** | **10+ calls** | **5+ seconds** |

## Solution: Redis Caching

**Performance improvement**: 5+ seconds → **<100ms response time**

### Cache Strategy

| Endpoint | Current Response Time | Cache TTL | Rationale |
|----------|---------------------|-----------|-----------|
| `/health` | 5+ seconds | **10 seconds** | Node status changes slowly |
| `/api/status` | 5+ seconds | **30 seconds** | Fiber counts update gradually |
| `/api/metagraph` | 5+ seconds | **5 seconds** | Needs freshness for monitoring |

### Implementation Plan

1. **Redis Cache Service** (`packages/monitor/src/cache.ts`)
   - Connection to existing Redis instance
   - Type-safe cache keys and values
   - TTL management per endpoint

2. **Background Refresh** 
   - Every 5 seconds refresh all cached data
   - Cache-aside pattern: warm cache proactively
   - Prevents cache misses during peak usage

3. **API Modifications**
   - Check cache first
   - Fall back to real-time collection on cache miss
   - Return cached data with `X-Cache: HIT/MISS` headers

## Benefits

- **99% response time improvement** (5s → 100ms)
- **Reduced load** on metagraph nodes 
- **Better UX** for dashboard and API consumers
- **Graceful degradation** on cache failures

## Implementation

### 1. Cache Service

```typescript
// packages/monitor/src/cache.ts
interface CacheConfig {
  healthTTL: number;    // 10 seconds
  statusTTL: number;    // 30 seconds  
  metagraphTTL: number; // 5 seconds
}

class MonitorCache {
  async get<T>(key: string): Promise<T | null>
  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void>
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T>
}
```

### 2. Background Refresh Job

- **Frequency**: Every 5 seconds  
- **Action**: Refresh all cache keys proactively
- **Benefit**: Cache always warm, never stale

### 3. API Response Headers

```
X-Cache: HIT           # Served from cache
X-Cache: MISS          # Fresh data from collection  
X-Cache-TTL: 25        # Seconds until expiry
```

## Risk Mitigation

- **Cache failures → fallback** to real-time collection
- **Redis unavailable → no caching**, normal operation
- **Cache corruption → auto-expire** with TTLs
- **Stale data → background refresh** keeps data fresh

## Success Metrics

- [ ] API response time <100ms for cached endpoints
- [ ] Cache hit ratio >95% under normal load  
- [ ] No functional regression in data accuracy
- [ ] Graceful fallback on Redis failures