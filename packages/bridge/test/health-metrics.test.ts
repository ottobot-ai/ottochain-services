/**
 * Bridge Health Endpoint Metrics — Unit Tests
 *
 * Test cases from Trello card "Bridge: Health Endpoint Metrics" (69963307):
 *  1. "returns p50/p95/p99" — health endpoint includes percentile metrics
 *  2. "handles no data gracefully" — returns nulls when no request history
 *  3. "sliding window works" — old data ages out, recent data dominates
 *
 * These tests cover ResponseTimeTracker in isolation (no HTTP server needed).
 *
 * Run: node --test --experimental-strip-types test/health-metrics.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ResponseTimeTracker } from '../src/lib/response-time-tracker.ts';
import type { TrackerOptions } from '../src/lib/response-time-tracker.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a fresh tracker for each test. */
function makeTracker(options?: TrackerOptions) {
  return new ResponseTimeTracker(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 1: "handles no data gracefully"
// ─────────────────────────────────────────────────────────────────────────────
describe('ResponseTimeTracker — cold start / no data', () => {
  it('returns null percentiles when no samples recorded', () => {
    const tracker = makeTracker();
    const result = tracker.percentiles();
    assert.strictEqual(result.p50, null, 'p50 must be null with no data');
    assert.strictEqual(result.p95, null, 'p95 must be null with no data');
    assert.strictEqual(result.p99, null, 'p99 must be null with no data');
  });

  it('returns null after clear()', () => {
    const tracker = makeTracker();
    tracker.record(100);
    tracker.record(200);
    tracker.clear();
    const result = tracker.percentiles();
    assert.strictEqual(result.p50, null);
    assert.strictEqual(result.p95, null);
    assert.strictEqual(result.p99, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 2: "returns p50/p95/p99"
// ─────────────────────────────────────────────────────────────────────────────
describe('ResponseTimeTracker — percentile calculations', () => {

  it('single sample: all percentiles equal that sample', () => {
    const tracker = makeTracker();
    tracker.record(42);
    const { p50, p95, p99 } = tracker.percentiles();
    assert.strictEqual(p50, 42);
    assert.strictEqual(p95, 42);
    assert.strictEqual(p99, 42);
  });

  it('two samples: p50 = lower, p95 = p99 = higher', () => {
    const tracker = makeTracker();
    tracker.record(10);
    tracker.record(100);
    const { p50, p95, p99 } = tracker.percentiles();
    // sorted: [10, 100]
    // p50 = ceil(50/100 * 2) - 1 = ceil(1) - 1 = 0 → 10
    assert.strictEqual(p50, 10);
    // p95 = ceil(95/100 * 2) - 1 = ceil(1.9) - 1 = 2 - 1 = 1 → 100
    assert.strictEqual(p95, 100);
    assert.strictEqual(p99, 100);
  });

  it('calculates correct percentiles for a known dataset', () => {
    const tracker = makeTracker();
    // Record 10 samples: 10, 20, 30, ..., 100
    for (let i = 1; i <= 10; i++) {
      tracker.record(i * 10);
    }
    // sorted: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const { p50, p95, p99 } = tracker.percentiles();

    // p50: ceil(50/100 * 10) - 1 = 5 - 1 = 4 → sorted[4] = 50
    assert.strictEqual(p50, 50, `expected p50=50, got ${p50}`);

    // p95: ceil(95/100 * 10) - 1 = ceil(9.5) - 1 = 10 - 1 = 9 → sorted[9] = 100
    assert.strictEqual(p95, 100, `expected p95=100, got ${p95}`);

    // p99: ceil(99/100 * 10) - 1 = ceil(9.9) - 1 = 10 - 1 = 9 → sorted[9] = 100
    assert.strictEqual(p99, 100, `expected p99=100, got ${p99}`);
  });

  it('handles 100 uniform samples correctly', () => {
    const tracker = makeTracker();
    for (let i = 1; i <= 100; i++) {
      tracker.record(i); // 1ms..100ms
    }
    const { p50, p95, p99 } = tracker.percentiles();
    // sorted: [1, 2, ..., 100]
    // p50: ceil(50) - 1 = 49 → sorted[49] = 50
    assert.strictEqual(p50, 50);
    // p95: ceil(95) - 1 = 94 → sorted[94] = 95
    assert.strictEqual(p95, 95);
    // p99: ceil(99) - 1 = 98 → sorted[98] = 99
    assert.strictEqual(p99, 99);
  });

  it('returns numeric (non-null) percentiles when samples present', () => {
    const tracker = makeTracker();
    [15, 25, 35, 45, 55].forEach(d => tracker.record(d));
    const { p50, p95, p99 } = tracker.percentiles();
    assert.ok(p50 !== null && typeof p50 === 'number', 'p50 should be a number');
    assert.ok(p95 !== null && typeof p95 === 'number', 'p95 should be a number');
    assert.ok(p99 !== null && typeof p99 === 'number', 'p99 should be a number');
  });

  it('p50 <= p95 <= p99 (ordering invariant)', () => {
    const tracker = makeTracker();
    // Random-ish distribution
    [5, 200, 15, 800, 10, 1000, 8, 300, 12, 50].forEach(d => tracker.record(d));
    const { p50, p95, p99 } = tracker.percentiles();
    assert.ok(p50! <= p95!, `p50 (${p50}) must be <= p95 (${p95})`);
    assert.ok(p95! <= p99!, `p95 (${p95}) must be <= p99 (${p99})`);
  });

  it('respects MAX_SAMPLES cap (buffer does not exceed 1000)', () => {
    const tracker = makeTracker();
    for (let i = 0; i < 1200; i++) {
      tracker.record(i);
    }
    // Size is bounded at 1000; percentiles still work
    assert.strictEqual(tracker.size, 1000, 'Buffer must not exceed MAX_SAMPLES');
    const { p50, p95, p99 } = tracker.percentiles();
    assert.ok(p50 !== null, 'Should still produce percentiles after eviction');
    assert.ok(p95 !== null);
    assert.ok(p99 !== null);
  });

  it('custom maxSamples cap is respected', () => {
    const tracker = makeTracker({ maxSamples: 5 });
    for (let i = 1; i <= 10; i++) {
      tracker.record(i * 10);
    }
    assert.strictEqual(tracker.size, 5, 'Buffer must not exceed custom maxSamples');
    // Only the last 5 samples remain: [60, 70, 80, 90, 100]
    const { p50 } = tracker.percentiles();
    assert.strictEqual(p50, 80, 'p50 of [60,70,80,90,100] = sorted[2] = 80');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 3: "sliding window works" (using injected clock)
// ─────────────────────────────────────────────────────────────────────────────
describe('ResponseTimeTracker — sliding window expiry', () => {

  it('expires samples outside the 5-minute window', () => {
    let fakeNow = 1_000_000;
    const tracker = makeTracker({ now: () => fakeNow });

    // Record samples at t=1_000_000
    tracker.record(999);
    tracker.record(999);

    // Advance clock past the 5-minute window
    fakeNow += 5 * 60 * 1000 + 1; // 5 min + 1ms

    // Record new samples at the new time
    [10, 20, 30, 40, 50].forEach(d => tracker.record(d));

    const { p50 } = tracker.percentiles();
    // Only the recent [10, 20, 30, 40, 50] should be in window
    // Sorted: [10, 20, 30, 40, 50] → p50 = sorted[2] = 30
    assert.strictEqual(p50, 30, 'p50 should reflect only recent samples after old ones expire');
  });

  it('returns null when all samples are outside the window', () => {
    let fakeNow = 1_000_000;
    const tracker = makeTracker({ now: () => fakeNow });

    [100, 200, 300].forEach(d => tracker.record(d));

    // Advance clock past the window
    fakeNow += 6 * 60 * 1000; // 6 minutes

    const { p50, p95, p99 } = tracker.percentiles();
    assert.strictEqual(p50, null, 'p50 should be null when window is empty');
    assert.strictEqual(p95, null, 'p95 should be null when window is empty');
    assert.strictEqual(p99, null, 'p99 should be null when window is empty');
    // Buffer still has samples, but they're all expired
    assert.strictEqual(tracker.size, 3, 'Expired samples remain in buffer until evicted by new records');
  });

  it('recent samples dominate when old data coexists in buffer', () => {
    let fakeNow = 1_000_000;
    const tracker = makeTracker({ now: () => fakeNow });

    // Record an outlier at t=1_000_000
    tracker.record(1000);

    // Advance past window
    fakeNow += 5 * 60 * 1000 + 1;

    // Record recent group
    [10, 20, 30, 40, 50].forEach(d => tracker.record(d));

    const { p50 } = tracker.percentiles();
    assert.ok((p50 ?? 0) < 100, `p50 (${p50}) should reflect recent samples, not old outlier`);
    // Buffer has 6 samples total but only 5 are in window
    assert.strictEqual(tracker.size, 6, 'Old sample still in buffer');
  });

  it('custom windowMs is respected', () => {
    let fakeNow = 1_000_000;
    const tracker = makeTracker({ windowMs: 10_000, now: () => fakeNow }); // 10s window

    tracker.record(100);

    fakeNow += 11_000; // 11 seconds later
    const { p50 } = tracker.percentiles();
    assert.strictEqual(p50, null, 'Sample should be expired with 10s window');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: health endpoint shape
// ─────────────────────────────────────────────────────────────────────────────
describe('ResponseTimeTracker — health endpoint shape', () => {

  it('percentiles() result matches expected health response schema', () => {
    const tracker = makeTracker();
    tracker.record(50);
    tracker.record(150);

    const perc = tracker.percentiles();

    // Verify the exact shape the /health handler will embed
    const healthResponse = {
      status: 'ok',
      service: 'bridge',
      responseTime: perc,
    };

    assert.ok('status'       in healthResponse, 'health response must have status');
    assert.ok('service'      in healthResponse, 'health response must have service');
    assert.ok('responseTime' in healthResponse, 'health response must have responseTime');
    assert.ok('p50' in healthResponse.responseTime, 'responseTime must have p50');
    assert.ok('p95' in healthResponse.responseTime, 'responseTime must have p95');
    assert.ok('p99' in healthResponse.responseTime, 'responseTime must have p99');
  });

  it('cold-start health response has null percentiles (not undefined)', () => {
    const tracker = makeTracker();
    const { p50, p95, p99 } = tracker.percentiles();
    // JSON.stringify(undefined) → field omitted; JSON.stringify(null) → "null"
    // We must emit null so the field appears in the response.
    assert.strictEqual(p50, null, 'p50 must be null (not undefined) for JSON serialisation');
    assert.strictEqual(p95, null, 'p95 must be null (not undefined) for JSON serialisation');
    assert.strictEqual(p99, null, 'p99 must be null (not undefined) for JSON serialisation');
  });
});
