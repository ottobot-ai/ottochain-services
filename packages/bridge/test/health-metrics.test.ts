/**
 * TDD Tests for Bridge Health Endpoint Metrics
 * 
 * These failing tests define the expected behavior for adding response time percentiles
 * (p50, p95, p99) to the bridge /health endpoint for better observability.
 * 
 * Card: Bridge: Health Endpoint Metrics (#69963307)
 * 
 * @group tdd
 * @group health
 * @group metrics
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock the ResponseTimeTracker class that needs to be implemented
interface ResponseTimeTracker {
  addSample(responseTimeMs: number): void;
  getPercentiles(): { p50: number | null; p95: number | null; p99: number | null } | null;
}

// Mock middleware that needs to be implemented
interface ResponseTimeMiddleware {
  (req: any, res: any, next: any): void;
}

describe('Bridge Health Endpoint Metrics: TDD Tests', () => {
  let app: express.Application;
  let tracker: ResponseTimeTracker;
  let middleware: ResponseTimeMiddleware;

  beforeEach(() => {
    app = express();
    
    // These imports will fail until implemented
    try {
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const { responseTimeMiddleware } = require('../../src/middleware/response-time');
      
      tracker = new ResponseTimeTracker();
      middleware = responseTimeMiddleware(tracker);
      
      app.use(middleware);
    } catch (error) {
      // Expected to fail in TDD Red phase
      console.log('Expected import failure during TDD Red phase:', error.message);
    }

    // Mock routes for testing
    app.get('/health', (req, res) => {
      // This implementation needs to be enhanced with metrics
      res.json({ status: 'ok', service: 'bridge' });
    });

    app.get('/test', (req, res) => {
      // Simulate variable response times
      setTimeout(() => {
        res.json({ message: 'test endpoint' });
      }, Math.random() * 100);
    });
  });

  describe('ResponseTimeTracker Class', () => {
    it('should initialize with empty state', () => {
      // ARRANGE: New tracker
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const tracker = new ResponseTimeTracker();
      
      // ACT: Get initial percentiles
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should return null for cold start
      expect(percentiles).toBe(null);
    });

    it('should store response time samples', () => {
      // ARRANGE: New tracker
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add samples
      tracker.addSample(50);
      tracker.addSample(100);
      tracker.addSample(150);
      
      // ASSERT: Should have samples stored
      const percentiles = tracker.getPercentiles();
      expect(percentiles).not.toBe(null);
      expect(typeof percentiles?.p50).toBe('number');
    });

    it('should calculate accurate percentiles', () => {
      // ARRANGE: Tracker with known data set
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add 100 samples from 1ms to 100ms
      for (let i = 1; i <= 100; i++) {
        tracker.addSample(i);
      }
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Percentiles should be approximately correct
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBeCloseTo(50, 5); // Median should be ~50
      expect(percentiles!.p95).toBeCloseTo(95, 5); // 95th percentile should be ~95
      expect(percentiles!.p99).toBeCloseTo(99, 5); // 99th percentile should be ~99
    });

    it('should implement sliding window (age out old data)', () => {
      // ARRANGE: Tracker configured for 5-minute window
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const tracker = new ResponseTimeTracker({ windowMinutes: 5 });
      
      // ACT: Add old samples (should be aged out)
      const oldTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      jest.spyOn(Date, 'now').mockReturnValue(oldTime);
      tracker.addSample(1000); // Very high response time
      
      // Add recent samples
      jest.spyOn(Date, 'now').mockReturnValue(Date.now());
      for (let i = 1; i <= 10; i++) {
        tracker.addSample(i * 10); // 10, 20, 30, ... 100ms
      }
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should not include the old 1000ms sample
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p99).toBeLessThan(500); // Should be much less than 1000
    });

    it('should handle circular buffer overflow', () => {
      // ARRANGE: Tracker with small buffer size
      const { ResponseTimeTracker } = require('../../src/metrics/response-time-tracker');
      const tracker = new ResponseTimeTracker({ maxSamples: 10 });
      
      // ACT: Add more samples than buffer size
      for (let i = 1; i <= 20; i++) {
        tracker.addSample(i);
      }
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should handle overflow gracefully
      expect(percentiles).not.toBe(null);
      expect(typeof percentiles?.p50).toBe('number');
      expect(typeof percentiles?.p95).toBe('number');
      expect(typeof percentiles?.p99).toBe('number');
    });
  });

  describe('Response Time Middleware', () => {
    it('should track response times for all requests', async () => {
      // ARRANGE: Spy on tracker
      const addSampleSpy = jest.spyOn(tracker, 'addSample');
      
      // ACT: Make request
      await request(app)
        .get('/test')
        .expect(200);
      
      // ASSERT: Should have recorded response time
      expect(addSampleSpy).toHaveBeenCalledWith(expect.any(Number));
      expect(addSampleSpy.mock.calls[0][0]).toBeGreaterThan(0);
    });

    it('should exclude /health endpoint from tracking', async () => {
      // ARRANGE: Spy on tracker
      const addSampleSpy = jest.spyOn(tracker, 'addSample');
      
      // ACT: Make request to health endpoint
      await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should NOT have recorded response time for /health
      expect(addSampleSpy).not.toHaveBeenCalled();
    });

    it('should handle middleware errors gracefully', async () => {
      // ARRANGE: Tracker that throws errors
      const faultyTracker = {
        addSample: jest.fn().mockImplementation(() => {
          throw new Error('Tracker error');
        }),
        getPercentiles: jest.fn().mockReturnValue(null)
      };
      
      const { responseTimeMiddleware } = require('../../src/middleware/response-time');
      const faultyMiddleware = responseTimeMiddleware(faultyTracker);
      
      app.use(faultyMiddleware);
      
      // ACT & ASSERT: Request should still succeed despite tracker error
      await request(app)
        .get('/test')
        .expect(200);
    });

    it('should measure actual response time accurately', async () => {
      // ARRANGE: Endpoint with known delay
      app.get('/slow', (req, res) => {
        setTimeout(() => res.json({ slow: true }), 50);
      });
      
      const addSampleSpy = jest.spyOn(tracker, 'addSample');
      
      // ACT: Make request
      const start = Date.now();
      await request(app)
        .get('/slow')
        .expect(200);
      const actualTime = Date.now() - start;
      
      // ASSERT: Recorded time should be close to actual time
      expect(addSampleSpy).toHaveBeenCalledWith(expect.any(Number));
      const recordedTime = addSampleSpy.mock.calls[0][0];
      expect(recordedTime).toBeCloseTo(actualTime, -1); // Within 10ms
    });
  });

  describe('/health Endpoint with Metrics', () => {
    it('should return basic health status', async () => {
      // ACT: Request health endpoint
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should contain basic health info
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('service', 'bridge');
    });

    it('should include responseTime metrics when data available', async () => {
      // ARRANGE: Populate tracker with sample data
      for (let i = 1; i <= 50; i++) {
        tracker.addSample(i * 2); // 2, 4, 6, ... 100ms
      }
      
      // ACT: Request health endpoint
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should include response time metrics
      expect(response.body).toHaveProperty('responseTime');
      expect(response.body.responseTime).toHaveProperty('p50');
      expect(response.body.responseTime).toHaveProperty('p95');
      expect(response.body.responseTime).toHaveProperty('p99');
      
      // Values should be numbers
      expect(typeof response.body.responseTime.p50).toBe('number');
      expect(typeof response.body.responseTime.p95).toBe('number');
      expect(typeof response.body.responseTime.p99).toBe('number');
      
      // Values should be reasonable
      expect(response.body.responseTime.p50).toBeGreaterThan(0);
      expect(response.body.responseTime.p95).toBeGreaterThan(response.body.responseTime.p50);
      expect(response.body.responseTime.p99).toBeGreaterThan(response.body.responseTime.p95);
    });

    it('should handle cold start gracefully (no metrics data)', async () => {
      // ARRANGE: Empty tracker
      jest.spyOn(tracker, 'getPercentiles').mockReturnValue(null);
      
      // ACT: Request health endpoint
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should handle null metrics gracefully
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('responseTime', null);
    });

    it('should handle partial metrics (insufficient data)', async () => {
      // ARRANGE: Tracker with minimal data
      jest.spyOn(tracker, 'getPercentiles').mockReturnValue({
        p50: 50,
        p95: null, // Not enough data for p95
        p99: null  // Not enough data for p99
      });
      
      // ACT: Request health endpoint
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should include available metrics with nulls for missing
      expect(response.body.responseTime).toEqual({
        p50: 50,
        p95: null,
        p99: null
      });
    });
  });

  describe('Integration: Full Metrics Pipeline', () => {
    it('should collect and report metrics end-to-end', async () => {
      // ARRANGE: Make several requests to populate metrics
      const requests = [];
      for (let i = 0; i < 20; i++) {
        requests.push(
          request(app).get('/test').expect(200)
        );
      }
      
      // ACT: Execute all requests
      await Promise.all(requests);
      
      // Then check health endpoint
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Should have collected metrics from requests
      expect(healthResponse.body.responseTime).not.toBe(null);
      expect(healthResponse.body.responseTime.p50).toBeGreaterThan(0);
      expect(healthResponse.body.responseTime.p95).toBeGreaterThan(0);
      expect(healthResponse.body.responseTime.p99).toBeGreaterThan(0);
    });

    it('should maintain metrics accuracy under load', async () => {
      // ARRANGE: Generate requests with known distribution
      const fastRequests = Array(80).fill(0).map((_, i) => 
        request(app).get('/test?fast=true').expect(200)
      );
      const slowRequests = Array(20).fill(0).map((_, i) => 
        request(app).get('/test?slow=true').expect(200)
      );
      
      // Mock endpoint responses
      app.get('/test', (req, res) => {
        const delay = req.query.fast ? 10 : 200; // 10ms vs 200ms
        setTimeout(() => res.json({ message: 'test' }), delay);
      });
      
      // ACT: Execute all requests
      await Promise.all([...fastRequests, ...slowRequests]);
      
      // Check metrics
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);
      
      // ASSERT: Percentiles should reflect the distribution
      const metrics = healthResponse.body.responseTime;
      expect(metrics.p50).toBeLessThan(100); // Median should be fast
      expect(metrics.p95).toBeGreaterThan(150); // 95th should include slow requests
    });

    it('should handle concurrent requests correctly', async () => {
      // ARRANGE: High concurrency scenario
      const concurrentRequests = Array(50).fill(0).map((_, i) => 
        request(app).get('/test').expect(200)
      );
      
      // ACT: Execute all requests concurrently
      await Promise.all(concurrentRequests);
      
      // ASSERT: Should handle concurrency without errors
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);
      
      expect(healthResponse.body.responseTime).not.toBe(null);
      expect(typeof healthResponse.body.responseTime.p50).toBe('number');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle zero response times', () => {
      // ARRANGE: Tracker with zero response time
      tracker.addSample(0);
      
      // ACT: Get percentiles
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should handle zero gracefully
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBe(0);
    });

    it('should handle very large response times', () => {
      // ARRANGE: Add extremely large response time
      tracker.addSample(Number.MAX_SAFE_INTEGER);
      tracker.addSample(50);
      tracker.addSample(100);
      
      // ACT: Get percentiles
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should not break with large numbers
      expect(percentiles).not.toBe(null);
      expect(typeof percentiles?.p99).toBe('number');
      expect(percentiles!.p99).toBeGreaterThan(0);
    });

    it('should handle invalid response time data', () => {
      // ARRANGE: Try to add invalid data
      const invalidValues = [NaN, Infinity, -Infinity, -100, undefined, null];
      
      // ACT: Attempt to add invalid values
      invalidValues.forEach(value => {
        expect(() => {
          tracker.addSample(value as number);
        }).not.toThrow(); // Should handle gracefully, not crash
      });
      
      // ASSERT: Should still function after invalid inputs
      tracker.addSample(50);
      const percentiles = tracker.getPercentiles();
      expect(percentiles).not.toBe(null);
    });

    it('should handle Express middleware errors', async () => {
      // ARRANGE: Mock req/res objects that might cause errors
      const problematicApp = express();
      
      // Middleware that could cause issues
      problematicApp.use((req, res, next) => {
        // Simulate potential middleware conflicts
        res.on = jest.fn().mockImplementation(() => {
          throw new Error('Event listener error');
        });
        next();
      });
      
      problematicApp.use(middleware);
      problematicApp.get('/test', (req, res) => res.json({ ok: true }));
      
      // ACT & ASSERT: Should handle middleware errors gracefully
      await request(problematicApp)
        .get('/test')
        .expect(200);
    });
  });
});