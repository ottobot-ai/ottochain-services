/**
 * Sequence Cache Unit Tests
 *
 * Tests the in-process optimistic sequence tracking added to fix Issue #109:
 * "Bridge sends same targetSequenceNumber for rapid successive transactions"
 */

import { describe, it, beforeEach, expect } from 'vitest';
import {
  advanceSequenceCache,
  resetFiberSequence,
  resolveSequence,
  _clearSequenceCacheForTesting,
  _getSequenceCacheForTesting,
} from '../src/metagraph.js';

// ─── Tests using real metagraph.ts implementation ────────────────────────────

describe('Optimistic Sequence Cache (Issue #109 fix)', () => {

  beforeEach(() => {
    _clearSequenceCacheForTesting();
  });

  it('returns DL1 value when cache is empty', () => {
    const fiberId = 'fiber-a';
    expect(resolveSequence(fiberId, 5)).toBe(5);
  });

  it('returns cached value when higher than DL1', () => {
    const fiberId = 'fiber-b';
    advanceSequenceCache(fiberId, 0);
    expect(resolveSequence(fiberId, 0)).toBe(1);
  });

  it('models rapid open → commit → close correctly', () => {
    const fiberId = 'fiber-market-001';
    const dl1Value = 0;

    const openSeq = resolveSequence(fiberId, dl1Value);
    expect(openSeq).toBe(0);
    advanceSequenceCache(fiberId, openSeq);

    const commitSeq1 = resolveSequence(fiberId, dl1Value);
    expect(commitSeq1).toBe(1);
    advanceSequenceCache(fiberId, commitSeq1);

    const commitSeq2 = resolveSequence(fiberId, dl1Value);
    expect(commitSeq2).toBe(2);
    advanceSequenceCache(fiberId, commitSeq2);

    const closeSeq = resolveSequence(fiberId, dl1Value);
    expect(closeSeq).toBe(3);
  });

  it('handles DL1 catching up: uses DL1 when higher than cache', () => {
    const fiberId = 'fiber-c';

    advanceSequenceCache(fiberId, 0);
    advanceSequenceCache(fiberId, 1);
    advanceSequenceCache(fiberId, 2);

    const resolved = resolveSequence(fiberId, 5);
    expect(resolved).toBe(5);
  });

  it('advance is monotonic — never goes backwards', () => {
    const fiberId = 'fiber-d';
    const cache = _getSequenceCacheForTesting();

    advanceSequenceCache(fiberId, 5);
    advanceSequenceCache(fiberId, 3);
    expect(cache.get(fiberId)).toBe(6);
  });

  it('reset clears the cache for a fiber', () => {
    const fiberId = 'fiber-e';
    const cache = _getSequenceCacheForTesting();

    advanceSequenceCache(fiberId, 2);
    expect(cache.get(fiberId)).toBe(3);

    resetFiberSequence(fiberId);
    expect(cache.has(fiberId)).toBe(false);

    expect(resolveSequence(fiberId, 0)).toBe(0);
  });

  it('error path: reset allows fresh DL1 read on retry', () => {
    const fiberId = 'fiber-f';

    const seq1 = resolveSequence(fiberId, 2);
    expect(seq1).toBe(2);
    resetFiberSequence(fiberId);

    const seq2 = resolveSequence(fiberId, 2);
    expect(seq2).toBe(2);
  });

  it('independent fibers do not interfere', () => {
    const fiberA = 'fiber-market-A';
    const fiberB = 'fiber-market-B';

    advanceSequenceCache(fiberA, 0);
    advanceSequenceCache(fiberA, 1);
    advanceSequenceCache(fiberA, 2);

    expect(resolveSequence(fiberA, 0)).toBe(3);
    expect(resolveSequence(fiberB, 0)).toBe(0);
  });

});

// ─── Eviction behavior tests (inline reimplementation with TEST_CACHE_MAX_SIZE=5)

describe('Sequence Cache eviction behavior (inline, size=5)', () => {

  const TEST_CACHE_MAX_SIZE = 5;
  const testCache = new Map<string, number>();

  function evictOldest(): void {
    while (testCache.size >= TEST_CACHE_MAX_SIZE) {
      const oldestKey = testCache.keys().next().value;
      if (oldestKey) testCache.delete(oldestKey);
      else break;
    }
  }

  function advance(fiberId: string, submittedSeq: number): void {
    const next = submittedSeq + 1;
    const cached = testCache.get(fiberId) ?? 0;
    if (next > cached) {
      testCache.delete(fiberId);
      evictOldest();
      testCache.set(fiberId, next);
    }
  }

  beforeEach(() => { testCache.clear(); });

  it('evicts oldest entries when cache is full (FIFO)', () => {
    advance('fiber-1', 0);
    advance('fiber-2', 0);
    advance('fiber-3', 0);
    advance('fiber-4', 0);
    advance('fiber-5', 0);

    expect(testCache.size).toBe(5);
    expect(testCache.has('fiber-1')).toBe(true);

    advance('fiber-6', 0);

    expect(testCache.size).toBe(5);
    expect(testCache.has('fiber-1')).toBe(false);
    expect(testCache.has('fiber-6')).toBe(true);
    expect(testCache.has('fiber-2')).toBe(true);
  });

  it('updating existing fiber refreshes its position (LRU-style)', () => {
    advance('fiber-A', 0);
    advance('fiber-B', 0);
    advance('fiber-C', 0);
    advance('fiber-D', 0);
    advance('fiber-E', 0);

    advance('fiber-A', 1);

    advance('fiber-F', 0);

    expect(testCache.has('fiber-A')).toBe(true);
    expect(testCache.has('fiber-B')).toBe(false);
    expect(testCache.has('fiber-F')).toBe(true);
  });

  it('cache size limit prevents unbounded growth', () => {
    for (let i = 0; i < 20; i++) {
      advance(`fiber-${i}`, 0);
    }

    expect(testCache.size).toBe(TEST_CACHE_MAX_SIZE);
    expect(testCache.has('fiber-0')).toBe(false);
    expect(testCache.has('fiber-14')).toBe(false);
    expect(testCache.has('fiber-15')).toBe(true);
    expect(testCache.has('fiber-19')).toBe(true);
  });

});

// Run if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('Running sequence cache unit tests...');
}
