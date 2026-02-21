# Bridge Health Endpoint Metrics - TDD Test Suite

## Overview

This directory contains comprehensive TDD tests for adding response time percentile metrics (p50, p95, p99) to the bridge `/health` endpoint.

**Card:** Bridge: Health Endpoint Metrics (#69963307)  
**Status:** TDD Red Phase - All tests currently FAIL awaiting implementation

## Test Files

### 1. `health-metrics.test.ts` - Integration Tests
- End-to-end testing of the complete metrics pipeline
- Health endpoint response format validation
- Integration between middleware and tracker components
- Error handling and edge cases
- **Coverage:** 25+ integration test scenarios

### 2. `response-time-tracker.test.ts` - ResponseTimeTracker Unit Tests  
- Circular buffer implementation (max 1000 samples)
- Sliding 5-minute time window management
- Percentile calculation accuracy (p50/p95/p99)
- Memory management and performance
- **Coverage:** 30+ unit test scenarios

### 3. `response-time-middleware.test.ts` - Express Middleware Unit Tests
- Request response time measurement
- Path exclusion logic (/health endpoint self-exclusion)
- Concurrent request handling
- Timing accuracy validation
- **Coverage:** 25+ middleware test scenarios

## Implementation Requirements

Based on @research feasibility analysis and these test specifications:

### ResponseTimeTracker Class
```typescript
interface ResponseTimeTracker {
  constructor(config?: { 
    maxSamples?: number;      // Default: 1000
    windowMinutes?: number;   // Default: 5
  });
  
  addSample(responseTimeMs: number): void;
  getPercentiles(): { 
    p50: number | null; 
    p95: number | null; 
    p99: number | null; 
  } | null;
  getSampleCount(): number;
  clear(): void;
}
```

**Features:**
- Circular buffer with configurable max size (default: 1000)
- Sliding time window (default: 5 minutes)
- Efficient percentile calculation
- Handles invalid input gracefully
- Memory-efficient with automatic cleanup

### Express Middleware
```typescript
interface ResponseTimeMiddleware {
  (tracker: ResponseTimeTracker, options?: {
    excludePaths?: string[];    // Default: ['/health']
    onError?: (error: Error) => void;
  }): (req, res, next) => void;
}
```

**Features:**
- Measures actual response time using `res.on('finish')`
- Excludes `/health` path to avoid self-measurement
- Configurable path exclusions with wildcard support
- Graceful error handling (doesn't break request flow)
- High-precision timing with `Date.now()`

### Enhanced /health Endpoint Response
```json
{
  "status": "ok",
  "service": "bridge", 
  "responseTime": {
    "p50": 45.2,
    "p95": 156.8,
    "p99": 287.1
  }
}
```

**Cold Start:** `"responseTime": null` when no data available

## Running Tests

```bash
# Run all health metrics tests
npm test -- --testPathPattern="health|response-time"

# Run specific test file
npm test -- health-metrics.test.ts
npm test -- response-time-tracker.test.ts
npm test -- response-time-middleware.test.ts

# Watch mode during development
npm test -- --watch --testPathPattern="health"
```

## Expected Test Status

**Current Status:** ❌ All tests FAIL (TDD Red Phase)

**After Implementation:** ✅ All tests PASS (TDD Green Phase)

## Implementation Files to Create

1. `src/metrics/response-time-tracker.ts` - ResponseTimeTracker class
2. `src/middleware/response-time.ts` - Express middleware  
3. `src/index.ts` - Update health endpoint and wire middleware

## Architecture Notes

- **Zero new dependencies** - Uses only Node.js stdlib
- **In-memory circular buffer** - No external storage required
- **Performance optimized** - Efficient percentile calculation
- **Production ready** - Handles errors gracefully, doesn't impact response flow
- **Cold start friendly** - Returns null when insufficient data

## Reference

- **Feasibility Analysis:** Completed by @research (2026-02-21)
- **Design Pattern:** Similar to traffic-gen status-server + monitor latencyMs
- **Performance Target:** <1ms overhead per request
- **Memory Target:** <10MB for 1000 samples with timestamps

---

**Next Steps:** Implement the components to make these failing tests pass! 🚀