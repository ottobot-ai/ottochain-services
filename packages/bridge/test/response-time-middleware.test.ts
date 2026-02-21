/**
 * TDD Tests for Response Time Middleware
 * 
 * Unit tests for Express middleware that tracks response times and integrates
 * with ResponseTimeTracker. Based on @research feasibility: skip /health path
 * to avoid self-measurement.
 * 
 * Card: Bridge: Health Endpoint Metrics (#69963307)
 * 
 * @group tdd
 * @group middleware
 * @group unit
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

interface ResponseTimeTracker {
  addSample(responseTimeMs: number): void;
  getPercentiles(): { p50: number | null; p95: number | null; p99: number | null } | null;
  getSampleCount(): number;
}

interface ResponseTimeMiddlewareOptions {
  excludePaths?: string[];
  onError?: (error: Error) => void;
}

describe('Response Time Middleware Unit Tests', () => {
  let responseTimeMiddleware: (tracker: ResponseTimeTracker, options?: ResponseTimeMiddlewareOptions) => any;
  let mockTracker: ResponseTimeTracker;
  let app: express.Application;

  beforeEach(() => {
    // Mock ResponseTimeTracker
    mockTracker = {
      addSample: jest.fn(),
      getPercentiles: jest.fn().mockReturnValue({ p50: 50, p95: 95, p99: 99 }),
      getSampleCount: jest.fn().mockReturnValue(10)
    };

    // This import will fail until middleware is implemented
    try {
      const module = require('../../src/middleware/response-time');
      responseTimeMiddleware = module.responseTimeMiddleware;
    } catch (error) {
      // Expected failure during TDD Red phase
      console.log('Expected middleware import failure during TDD Red phase');
    }

    // Set up Express app for testing
    app = express();
    app.use(express.json());
  });

  describe('Middleware Initialization', () => {
    it('should create middleware with tracker', () => {
      // ACT: Create middleware
      const middleware = responseTimeMiddleware(mockTracker);
      
      // ASSERT: Should return function
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // (req, res, next) => void
    });

    it('should accept options parameter', () => {
      // ACT: Create middleware with options
      const middleware = responseTimeMiddleware(mockTracker, {
        excludePaths: ['/health', '/metrics'],
        onError: jest.fn()
      });
      
      // ASSERT: Should return function without error
      expect(typeof middleware).toBe('function');
    });

    it('should handle missing options gracefully', () => {
      // ACT: Create middleware without options
      const middleware = responseTimeMiddleware(mockTracker);
      
      // ASSERT: Should work with default options
      expect(typeof middleware).toBe('function');
    });
  });

  describe('Response Time Tracking', () => {
    beforeEach(() => {
      const middleware = responseTimeMiddleware(mockTracker);
      app.use(middleware);
      
      // Add test routes
      app.get('/test', (req, res) => {
        setTimeout(() => res.json({ success: true }), 50);
      });
      
      app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
      });
    });

    it('should track response time for regular endpoints', async () => {
      // ACT: Make request to tracked endpoint
      await request(app)
        .get('/test')
        .expect(200);

      // ASSERT: Should have called addSample with response time
      expect(mockTracker.addSample).toHaveBeenCalledWith(expect.any(Number));
      
      const recordedTime = (mockTracker.addSample as jest.Mock).mock.calls[0][0];
      expect(recordedTime).toBeGreaterThan(40); // Should be at least 40ms due to setTimeout
      expect(recordedTime).toBeLessThan(200);   // Should be reasonable
    });

    it('should exclude /health endpoint from tracking', async () => {
      // ACT: Make request to health endpoint
      await request(app)
        .get('/health')
        .expect(200);

      // ASSERT: Should NOT have called addSample
      expect(mockTracker.addSample).not.toHaveBeenCalled();
    });

    it('should exclude custom paths when configured', async () => {
      // ARRANGE: Create app with custom exclusions
      const customApp = express();
      const customMiddleware = responseTimeMiddleware(mockTracker, {
        excludePaths: ['/health', '/metrics', '/status']
      });
      customApp.use(customMiddleware);
      
      customApp.get('/metrics', (req, res) => res.json({ metrics: true }));
      customApp.get('/status', (req, res) => res.json({ status: true }));
      customApp.get('/tracked', (req, res) => res.json({ tracked: true }));

      // ACT: Make requests to excluded and included paths
      await request(customApp).get('/metrics').expect(200);
      await request(customApp).get('/status').expect(200);
      await request(customApp).get('/tracked').expect(200);

      // ASSERT: Should only track /tracked endpoint
      expect(mockTracker.addSample).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent requests correctly', async () => {
      // ACT: Make multiple concurrent requests
      const requests = Array(10).fill(0).map(() => 
        request(app).get('/test').expect(200)
      );
      
      await Promise.all(requests);

      // ASSERT: Should track all requests
      expect(mockTracker.addSample).toHaveBeenCalledTimes(10);
      
      // All recorded times should be reasonable
      const recordedTimes = (mockTracker.addSample as jest.Mock).mock.calls.map(call => call[0]);
      recordedTimes.forEach(time => {
        expect(time).toBeGreaterThan(0);
        expect(time).toBeLessThan(1000);
      });
    });

    it('should track different endpoints separately', async () => {
      // ARRANGE: Add another test route
      app.get('/fast', (req, res) => {
        setTimeout(() => res.json({ fast: true }), 10);
      });
      
      app.get('/slow', (req, res) => {
        setTimeout(() => res.json({ slow: true }), 100);
      });

      // ACT: Make requests to different endpoints
      await request(app).get('/fast').expect(200);
      await request(app).get('/slow').expect(200);

      // ASSERT: Should track both with different times
      expect(mockTracker.addSample).toHaveBeenCalledTimes(2);
      
      const [fastTime, slowTime] = (mockTracker.addSample as jest.Mock).mock.calls.map(call => call[0]);
      expect(slowTime).toBeGreaterThan(fastTime);
    });
  });

  describe('Error Handling', () => {
    it('should handle tracker errors gracefully', async () => {
      // ARRANGE: Tracker that throws errors
      const faultyTracker = {
        ...mockTracker,
        addSample: jest.fn().mockImplementation(() => {
          throw new Error('Tracker error');
        })
      };
      
      const middleware = responseTimeMiddleware(faultyTracker);
      app.use(middleware);
      app.get('/test', (req, res) => res.json({ test: true }));

      // ACT & ASSERT: Request should still succeed
      await request(app)
        .get('/test')
        .expect(200);
    });

    it('should call error handler when provided', async () => {
      // ARRANGE: Tracker with error handler
      const errorHandler = jest.fn();
      const faultyTracker = {
        ...mockTracker,
        addSample: jest.fn().mockImplementation(() => {
          throw new Error('Tracker error');
        })
      };
      
      const middleware = responseTimeMiddleware(faultyTracker, { onError: errorHandler });
      app.use(middleware);
      app.get('/test', (req, res) => res.json({ test: true }));

      // ACT: Make request
      await request(app).get('/test').expect(200);

      // ASSERT: Error handler should be called
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle response listener errors', async () => {
      // ARRANGE: Mock response with faulty event listener
      const middleware = responseTimeMiddleware(mockTracker);
      app.use((req, res, next) => {
        // Mock faulty response
        const originalOn = res.on;
        res.on = jest.fn().mockImplementation(() => {
          throw new Error('Response listener error');
        });
        next();
      });
      app.use(middleware);
      app.get('/test', (req, res) => res.json({ test: true }));

      // ACT & ASSERT: Should not crash the server
      await request(app)
        .get('/test')
        .expect(200);
    });

    it('should handle missing request/response objects', () => {
      // ARRANGE: Middleware with invalid req/res
      const middleware = responseTimeMiddleware(mockTracker);
      
      // ACT & ASSERT: Should not crash with invalid objects
      expect(() => {
        middleware(null as any, null as any, jest.fn());
      }).not.toThrow();
    });
  });

  describe('Timing Accuracy', () => {
    beforeEach(() => {
      // Use real timers for accuracy tests
      jest.useRealTimers();
    });

    it('should measure response time accurately', async () => {
      // ARRANGE: Middleware and controlled delay endpoint
      const middleware = responseTimeMiddleware(mockTracker);
      app.use(middleware);
      
      app.get('/timed', (req, res) => {
        setTimeout(() => res.json({ timed: true }), 100);
      });

      // ACT: Make request with known delay
      const start = Date.now();
      await request(app).get('/timed').expect(200);
      const actualTime = Date.now() - start;

      // ASSERT: Recorded time should be close to actual time
      expect(mockTracker.addSample).toHaveBeenCalledWith(expect.any(Number));
      
      const recordedTime = (mockTracker.addSample as jest.Mock).mock.calls[0][0];
      expect(recordedTime).toBeCloseTo(actualTime, -1); // Within 10ms
      expect(recordedTime).toBeGreaterThan(90);  // At least 90ms
      expect(recordedTime).toBeLessThan(200);    // Less than 200ms
    });

    it('should handle very fast responses', async () => {
      // ARRANGE: Instant response endpoint
      const middleware = responseTimeMiddleware(mockTracker);
      app.use(middleware);
      
      app.get('/instant', (req, res) => {
        res.json({ instant: true }); // No delay
      });

      // ACT: Make request
      await request(app).get('/instant').expect(200);

      // ASSERT: Should record small but positive time
      expect(mockTracker.addSample).toHaveBeenCalledWith(expect.any(Number));
      
      const recordedTime = (mockTracker.addSample as jest.Mock).mock.calls[0][0];
      expect(recordedTime).toBeGreaterThanOrEqual(0);
      expect(recordedTime).toBeLessThan(50); // Should be very fast
    });

    it('should handle response time precision consistently', async () => {
      // ARRANGE: Multiple identical requests
      const middleware = responseTimeMiddleware(mockTracker);
      app.use(middleware);
      
      app.get('/consistent', (req, res) => {
        setTimeout(() => res.json({ consistent: true }), 50);
      });

      // ACT: Make multiple requests
      for (let i = 0; i < 5; i++) {
        await request(app).get('/consistent').expect(200);
      }

      // ASSERT: Times should be consistent (within reasonable range)
      expect(mockTracker.addSample).toHaveBeenCalledTimes(5);
      
      const recordedTimes = (mockTracker.addSample as jest.Mock).mock.calls.map(call => call[0]);
      const avgTime = recordedTimes.reduce((a, b) => a + b) / recordedTimes.length;
      
      recordedTimes.forEach(time => {
        expect(time).toBeCloseTo(avgTime, -1); // Within 10ms of average
      });
    });
  });

  describe('Path Matching', () => {
    it('should handle exact path matches', async () => {
      // ARRANGE: Middleware with exact path exclusion
      const middleware = responseTimeMiddleware(mockTracker, {
        excludePaths: ['/exact']
      });
      app.use(middleware);
      
      app.get('/exact', (req, res) => res.json({ exact: true }));
      app.get('/exact/sub', (req, res) => res.json({ sub: true }));

      // ACT: Make requests
      await request(app).get('/exact').expect(200);
      await request(app).get('/exact/sub').expect(200);

      // ASSERT: Only exact match should be excluded
      expect(mockTracker.addSample).toHaveBeenCalledTimes(1); // Only /exact/sub tracked
    });

    it('should handle wildcard path patterns', async () => {
      // ARRANGE: Middleware with pattern exclusion
      const middleware = responseTimeMiddleware(mockTracker, {
        excludePaths: ['/admin/*', '/health']
      });
      app.use(middleware);
      
      app.get('/admin/dashboard', (req, res) => res.json({ admin: true }));
      app.get('/admin/users', (req, res) => res.json({ users: true }));
      app.get('/public/page', (req, res) => res.json({ public: true }));

      // ACT: Make requests
      await request(app).get('/admin/dashboard').expect(200);
      await request(app).get('/admin/users').expect(200);
      await request(app).get('/public/page').expect(200);

      // ASSERT: Only /public/page should be tracked
      expect(mockTracker.addSample).toHaveBeenCalledTimes(1);
    });

    it('should handle query parameters correctly', async () => {
      // ARRANGE: Middleware with path exclusion
      const middleware = responseTimeMiddleware(mockTracker, {
        excludePaths: ['/health']
      });
      app.use(middleware);
      
      app.get('/health', (req, res) => res.json({ health: true }));
      app.get('/api', (req, res) => res.json({ api: true }));

      // ACT: Make requests with query parameters
      await request(app).get('/health?check=true').expect(200);
      await request(app).get('/api?version=1').expect(200);

      // ASSERT: Query parameters should not affect path matching
      expect(mockTracker.addSample).toHaveBeenCalledTimes(1); // Only /api tracked
    });
  });
});