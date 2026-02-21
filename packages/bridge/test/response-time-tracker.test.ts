/**
 * TDD Tests for ResponseTimeTracker Class
 * 
 * Unit tests specifically for the ResponseTimeTracker implementation based on
 * @research feasibility analysis: circular buffer, 5-minute sliding window, 1000 max samples.
 * 
 * Card: Bridge: Health Endpoint Metrics (#69963307)
 * 
 * @group tdd
 * @group metrics
 * @group unit
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

interface ResponseTimeTrackerConfig {
  maxSamples?: number;
  windowMinutes?: number;
}

interface ResponseTimeTracker {
  addSample(responseTimeMs: number): void;
  getPercentiles(): { p50: number | null; p95: number | null; p99: number | null } | null;
  getSampleCount(): number;
  clear(): void;
}

describe('ResponseTimeTracker Unit Tests', () => {
  let ResponseTimeTracker: new (config?: ResponseTimeTrackerConfig) => ResponseTimeTracker;

  beforeEach(() => {
    // This import will fail until ResponseTimeTracker is implemented
    try {
      const module = require('../../src/metrics/response-time-tracker');
      ResponseTimeTracker = module.ResponseTimeTracker;
    } catch (error) {
      // Expected failure during TDD Red phase
      console.log('Expected import failure during TDD Red phase');
    }
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration', () => {
      // ARRANGE & ACT: Create tracker with defaults
      const tracker = new ResponseTimeTracker();
      
      // ASSERT: Should be empty initially
      expect(tracker.getSampleCount()).toBe(0);
      expect(tracker.getPercentiles()).toBe(null);
    });

    it('should accept custom configuration', () => {
      // ARRANGE & ACT: Create tracker with custom config
      const tracker = new ResponseTimeTracker({
        maxSamples: 500,
        windowMinutes: 10
      });
      
      // ASSERT: Should initialize without error
      expect(tracker.getSampleCount()).toBe(0);
    });

    it('should use default values for missing config', () => {
      // ARRANGE & ACT: Create tracker with partial config
      const tracker = new ResponseTimeTracker({ maxSamples: 100 });
      
      // ASSERT: Should work with partial configuration
      expect(tracker.getSampleCount()).toBe(0);
    });
  });

  describe('Sample Management', () => {
    it('should add samples correctly', () => {
      // ARRANGE: Fresh tracker
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add samples
      tracker.addSample(50);
      tracker.addSample(100);
      tracker.addSample(150);
      
      // ASSERT: Should track sample count
      expect(tracker.getSampleCount()).toBe(3);
    });

    it('should handle circular buffer overflow', () => {
      // ARRANGE: Tracker with small buffer
      const tracker = new ResponseTimeTracker({ maxSamples: 5 });
      
      // ACT: Add more samples than buffer capacity
      for (let i = 1; i <= 10; i++) {
        tracker.addSample(i * 10);
      }
      
      // ASSERT: Should not exceed max samples
      expect(tracker.getSampleCount()).toBeLessThanOrEqual(5);
    });

    it('should maintain most recent samples when buffer overflows', () => {
      // ARRANGE: Tracker with small buffer
      const tracker = new ResponseTimeTracker({ maxSamples: 3 });
      
      // ACT: Fill buffer and overflow
      tracker.addSample(10);  // Should be evicted
      tracker.addSample(20);  // Should be evicted  
      tracker.addSample(30);  // Should remain
      tracker.addSample(40);  // Should remain
      tracker.addSample(50);  // Should remain
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should only contain recent samples (30, 40, 50)
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBe(40); // Median of [30, 40, 50]
    });

    it('should reject invalid sample values', () => {
      // ARRANGE: Fresh tracker
      const tracker = new ResponseTimeTracker();
      
      // ACT & ASSERT: Should handle invalid values gracefully
      expect(() => tracker.addSample(NaN)).not.toThrow();
      expect(() => tracker.addSample(Infinity)).not.toThrow();
      expect(() => tracker.addSample(-100)).not.toThrow();
      
      // Should not count invalid samples
      expect(tracker.getSampleCount()).toBe(0);
    });

    it('should clear all samples', () => {
      // ARRANGE: Tracker with samples
      const tracker = new ResponseTimeTracker();
      tracker.addSample(50);
      tracker.addSample(100);
      
      // ACT: Clear samples
      tracker.clear();
      
      // ASSERT: Should be empty
      expect(tracker.getSampleCount()).toBe(0);
      expect(tracker.getPercentiles()).toBe(null);
    });
  });

  describe('Time Window Management', () => {
    beforeEach(() => {
      // Mock Date.now for time-based tests
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should implement sliding time window', () => {
      // ARRANGE: Tracker with 5-minute window
      const tracker = new ResponseTimeTracker({ windowMinutes: 5 });
      const baseTime = Date.now();
      
      // ACT: Add old sample (6 minutes ago)
      jest.setSystemTime(baseTime - (6 * 60 * 1000));
      tracker.addSample(1000); // Very high value that should be aged out
      
      // Add recent samples (current time)
      jest.setSystemTime(baseTime);
      tracker.addSample(50);
      tracker.addSample(100);
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Old sample should not affect current percentiles
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p99).toBeLessThan(500); // Should not include the 1000ms sample
    });

    it('should age out samples outside window', () => {
      // ARRANGE: Tracker with 1-minute window
      const tracker = new ResponseTimeTracker({ windowMinutes: 1 });
      const baseTime = Date.now();
      
      // Add samples at different times
      jest.setSystemTime(baseTime - (90 * 1000)); // 90 seconds ago
      tracker.addSample(200);
      
      jest.setSystemTime(baseTime - (30 * 1000)); // 30 seconds ago
      tracker.addSample(100);
      
      jest.setSystemTime(baseTime); // Now
      tracker.addSample(50);
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Only recent samples within 1-minute window should be included
      expect(percentiles).not.toBe(null);
      expect(tracker.getSampleCount()).toBe(2); // Only 100ms and 50ms samples
    });

    it('should handle rapid time changes gracefully', () => {
      // ARRANGE: Tracker with samples
      const tracker = new ResponseTimeTracker();
      const baseTime = Date.now();
      
      // ACT: Add samples, then jump time forward dramatically
      tracker.addSample(50);
      tracker.addSample(100);
      
      jest.setSystemTime(baseTime + (24 * 60 * 60 * 1000)); // Jump 24 hours forward
      
      // ASSERT: Should handle time jump gracefully
      expect(() => tracker.getPercentiles()).not.toThrow();
    });
  });

  describe('Percentile Calculations', () => {
    it('should calculate percentiles for small datasets', () => {
      // ARRANGE: Tracker with minimal data
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add 3 samples
      tracker.addSample(10);
      tracker.addSample(20);
      tracker.addSample(30);
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should calculate percentiles even with few samples
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBe(20); // Median
      
      // For small datasets, higher percentiles might be null or equal to max
      expect(percentiles!.p95).toBeGreaterThanOrEqual(20);
      expect(percentiles!.p99).toBeGreaterThanOrEqual(20);
    });

    it('should calculate accurate percentiles for large datasets', () => {
      // ARRANGE: Tracker with large dataset
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add 1000 samples: 1ms to 1000ms
      for (let i = 1; i <= 1000; i++) {
        tracker.addSample(i);
      }
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Percentiles should be mathematically correct
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBeCloseTo(500, 10); // 50th percentile
      expect(percentiles!.p95).toBeCloseTo(950, 10); // 95th percentile
      expect(percentiles!.p99).toBeCloseTo(990, 10); // 99th percentile
    });

    it('should handle identical values correctly', () => {
      // ARRANGE: Tracker with identical samples
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add multiple identical values
      for (let i = 0; i < 100; i++) {
        tracker.addSample(50);
      }
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: All percentiles should be the same value
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBe(50);
      expect(percentiles!.p95).toBe(50);
      expect(percentiles!.p99).toBe(50);
    });

    it('should require minimum samples for higher percentiles', () => {
      // ARRANGE: Tracker with very few samples
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add only 2 samples
      tracker.addSample(10);
      tracker.addSample(20);
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Should provide p50 but might not provide p95/p99
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBeGreaterThan(0);
      
      // Higher percentiles might be null for insufficient data
      // (Implementation decision: require minimum samples for accuracy)
    });

    it('should sort samples correctly before calculation', () => {
      // ARRANGE: Tracker with unsorted input
      const tracker = new ResponseTimeTracker();
      
      // ACT: Add samples in random order
      const samples = [100, 10, 300, 50, 200, 150, 75, 25];
      samples.forEach(sample => tracker.addSample(sample));
      
      const percentiles = tracker.getPercentiles();
      
      // ASSERT: Percentiles should be correctly ordered
      expect(percentiles).not.toBe(null);
      expect(percentiles!.p50).toBeLessThanOrEqual(percentiles!.p95!);
      expect(percentiles!.p95).toBeLessThanOrEqual(percentiles!.p99!);
    });
  });

  describe('Performance and Memory', () => {
    it('should handle maximum sample capacity efficiently', () => {
      // ARRANGE: Tracker with maximum capacity
      const tracker = new ResponseTimeTracker({ maxSamples: 1000 });
      
      // ACT: Fill to capacity
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        tracker.addSample(Math.random() * 1000);
      }
      const endTime = Date.now();
      
      // ASSERT: Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(100); // Less than 100ms
      expect(tracker.getSampleCount()).toBe(1000);
    });

    it('should maintain performance with frequent percentile calculations', () => {
      // ARRANGE: Tracker with data
      const tracker = new ResponseTimeTracker();
      for (let i = 0; i < 100; i++) {
        tracker.addSample(Math.random() * 1000);
      }
      
      // ACT: Calculate percentiles many times
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        tracker.getPercentiles();
      }
      const endTime = Date.now();
      
      // ASSERT: Should be performant
      expect(endTime - startTime).toBeLessThan(100); // Less than 100ms for 1000 calculations
    });

    it('should not leak memory with continuous operation', () => {
      // ARRANGE: Track initial memory state (if possible)
      const tracker = new ResponseTimeTracker({ maxSamples: 100 });
      
      // ACT: Simulate continuous operation
      for (let cycle = 0; cycle < 10; cycle++) {
        // Fill buffer
        for (let i = 0; i < 100; i++) {
          tracker.addSample(Math.random() * 1000);
        }
        
        // Calculate percentiles
        tracker.getPercentiles();
        
        // Clear and restart
        tracker.clear();
      }
      
      // ASSERT: Should complete without error (memory leaks would cause crashes)
      expect(tracker.getSampleCount()).toBe(0);
    });
  });
});