/**
 * Sequence Cache Unit Tests
 *
 * Tests the in-process optimistic sequence tracking added to fix Issue #109:
 * "Bridge sends same targetSequenceNumber for rapid successive transactions"
 *
 * The sequence cache ensures that when getFiberSequenceNumber() is called
 * multiple times for the same fiber before DL1 has processed each transaction,
 * each call returns a monotonically increasing value based on how many
 * successful submissions have been made.
 *
 * This test file uses direct logic tests that don't require a running server.
 *
 * Run: node --test --experimental-strip-types test/sequence-cache.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ── Inline reimplementation of the cache for isolated unit testing ────────────
// (mirrors the logic in metagraph.ts exactly)

/** Use smaller limit for testing eviction behavior */
const TEST_CACHE_MAX_SIZE = 5;

const sequenceCache = new Map<string, number>();

function evictOldestIfNeeded(): void {
  while (sequenceCache.size >= TEST_CACHE_MAX_SIZE) {
    const oldestKey = sequenceCache.keys().next().value;
    if (oldestKey) {
      sequenceCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

function advanceSequenceCache(fiberId: string, submittedSeq: number): void {
  const next = submittedSeq + 1;
  const cached = sequenceCache.get(fiberId) ?? 0;
  if (next > cached) {
    // Delete and re-insert to update insertion order (for FIFO eviction)
    sequenceCache.delete(fiberId);
    evictOldestIfNeeded();
    sequenceCache.set(fiberId, next);
  }
}

function resetFiberSequence(fiberId: string): void {
  sequenceCache.delete(fiberId);
}

function resolveSequence(fiberId: string, dl1Seq: number): number {
  const cached = sequenceCache.get(fiberId) ?? 0;
  return Math.max(dl1Seq, cached);
}

function clearCache(): void {
  sequenceCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Optimistic Sequence Cache (Issue #109 fix)', () => {

  it('returns DL1 value when cache is empty', () => {
    clearCache();
    const fiberId = 'fiber-a';
    assert.strictEqual(resolveSequence(fiberId, 5), 5, 'Should return DL1 value when no cache');
  });

  it('returns cached value when higher than DL1', () => {
    clearCache();
    const fiberId = 'fiber-b';
    // Simulate: DL1 still at 0, but we already submitted seq=0 successfully (cache=1)
    advanceSequenceCache(fiberId, 0); // submitted seq=0 → cache becomes 1
    assert.strictEqual(resolveSequence(fiberId, 0), 1, 'Should return cached value (1) over stale DL1 (0)');
  });

  it('models rapid open → commit → close correctly', () => {
    clearCache();
    const fiberId = 'fiber-market-001';

    // DL1 returns 0 throughout (hasn't processed anything yet)
    const dl1Value = 0;

    // Step 1: open — reads seq 0, submits with targetSeq=0
    const openSeq = resolveSequence(fiberId, dl1Value); // = max(0, 0) = 0
    assert.strictEqual(openSeq, 0);
    advanceSequenceCache(fiberId, openSeq); // cache → 1

    // Step 2: commit agent1 — reads seq, DL1 still 0, cache=1
    const commitSeq1 = resolveSequence(fiberId, dl1Value); // = max(0, 1) = 1
    assert.strictEqual(commitSeq1, 1, 'commit-1 must get seq=1');
    advanceSequenceCache(fiberId, commitSeq1); // cache → 2

    // Step 3: commit agent2 — DL1 still 0, cache=2
    const commitSeq2 = resolveSequence(fiberId, dl1Value); // = max(0, 2) = 2
    assert.strictEqual(commitSeq2, 2, 'commit-2 must get seq=2 (not 1 again)');
    advanceSequenceCache(fiberId, commitSeq2); // cache → 3

    // Step 4: close — DL1 still 0, cache=3
    const closeSeq = resolveSequence(fiberId, dl1Value); // = max(0, 3) = 3
    assert.strictEqual(closeSeq, 3, 'close must get seq=3');
    advanceSequenceCache(fiberId, closeSeq); // cache → 4
  });

  it('handles DL1 catching up: uses DL1 when higher than cache', () => {
    clearCache();
    const fiberId = 'fiber-c';

    // Suppose cache had advanced to 3 from earlier rapid submissions,
    // but then DL1 caught up and reports 5 (e.g. after some time gap).
    advanceSequenceCache(fiberId, 0); // cache → 1
    advanceSequenceCache(fiberId, 1); // cache → 2
    advanceSequenceCache(fiberId, 2); // cache → 3

    // DL1 now reports 5 (it processed some snapshots we didn't know about)
    const resolved = resolveSequence(fiberId, 5); // = max(5, 3) = 5
    assert.strictEqual(resolved, 5, 'Should use DL1 value when higher than cache');
  });

  it('advance is monotonic — never goes backwards', () => {
    clearCache();
    const fiberId = 'fiber-d';

    advanceSequenceCache(fiberId, 5); // cache → 6
    advanceSequenceCache(fiberId, 3); // attempted backwards → should stay at 6
    assert.strictEqual(sequenceCache.get(fiberId), 6, 'Cache must not go backwards');
  });

  it('reset clears the cache for a fiber', () => {
    clearCache();
    const fiberId = 'fiber-e';

    advanceSequenceCache(fiberId, 2); // cache → 3
    assert.strictEqual(sequenceCache.get(fiberId), 3);

    resetFiberSequence(fiberId);
    assert.strictEqual(sequenceCache.has(fiberId), false, 'Cache should be cleared after reset');

    // After reset, resolveSequence returns raw DL1 value
    assert.strictEqual(resolveSequence(fiberId, 0), 0);
  });

  it('error path: reset allows fresh DL1 read on retry', () => {
    clearCache();
    const fiberId = 'fiber-f';

    // Initial submission
    const seq1 = resolveSequence(fiberId, 2); // DL1=2, cache=0 → 2
    assert.strictEqual(seq1, 2);
    // Submission fails — reset cache
    resetFiberSequence(fiberId);

    // Retry reads fresh from DL1
    const seq2 = resolveSequence(fiberId, 2); // DL1=2, cache=0 (reset) → 2
    assert.strictEqual(seq2, 2, 'After reset, should re-read DL1 value');
  });

  it('independent fibers do not interfere', () => {
    clearCache();
    const fiberA = 'fiber-market-A';
    const fiberB = 'fiber-market-B';

    advanceSequenceCache(fiberA, 0); // A cache → 1
    advanceSequenceCache(fiberA, 1); // A cache → 2
    advanceSequenceCache(fiberA, 2); // A cache → 3

    // fiberB has no cache
    assert.strictEqual(resolveSequence(fiberA, 0), 3, 'Fiber A should be at 3');
    assert.strictEqual(resolveSequence(fiberB, 0), 0, 'Fiber B should be independent (0)');
  });

  it('evicts oldest entries when cache is full (FIFO)', () => {
    clearCache();
    // TEST_CACHE_MAX_SIZE = 5

    // Fill cache with 5 fibers
    advanceSequenceCache('fiber-1', 0); // cache: [1]
    advanceSequenceCache('fiber-2', 0); // cache: [1, 2]
    advanceSequenceCache('fiber-3', 0); // cache: [1, 2, 3]
    advanceSequenceCache('fiber-4', 0); // cache: [1, 2, 3, 4]
    advanceSequenceCache('fiber-5', 0); // cache: [1, 2, 3, 4, 5]

    assert.strictEqual(sequenceCache.size, 5, 'Cache should have 5 entries');
    assert.ok(sequenceCache.has('fiber-1'), 'fiber-1 should still exist');

    // Add 6th fiber → should evict fiber-1 (oldest)
    advanceSequenceCache('fiber-6', 0); // cache: [2, 3, 4, 5, 6]

    assert.strictEqual(sequenceCache.size, 5, 'Cache should still have 5 entries');
    assert.ok(!sequenceCache.has('fiber-1'), 'fiber-1 should be evicted (oldest)');
    assert.ok(sequenceCache.has('fiber-6'), 'fiber-6 should exist');
    assert.ok(sequenceCache.has('fiber-2'), 'fiber-2 should still exist');
  });

  it('updating existing fiber refreshes its position (LRU-style)', () => {
    clearCache();
    // TEST_CACHE_MAX_SIZE = 5

    // Fill cache
    advanceSequenceCache('fiber-A', 0); // oldest
    advanceSequenceCache('fiber-B', 0);
    advanceSequenceCache('fiber-C', 0);
    advanceSequenceCache('fiber-D', 0);
    advanceSequenceCache('fiber-E', 0); // newest

    // Update fiber-A (should move it to end of insertion order)
    advanceSequenceCache('fiber-A', 1); // now fiber-B is oldest

    // Add new fiber — should evict fiber-B (now oldest), not fiber-A
    advanceSequenceCache('fiber-F', 0);

    assert.ok(sequenceCache.has('fiber-A'), 'fiber-A should still exist (was refreshed)');
    assert.ok(!sequenceCache.has('fiber-B'), 'fiber-B should be evicted (oldest after A refresh)');
    assert.ok(sequenceCache.has('fiber-F'), 'fiber-F should exist');
  });

  it('cache size limit prevents unbounded growth', () => {
    clearCache();

    // Add many more fibers than the limit
    for (let i = 0; i < 20; i++) {
      advanceSequenceCache(`fiber-${i}`, 0);
    }

    assert.strictEqual(sequenceCache.size, TEST_CACHE_MAX_SIZE, 
      `Cache should be capped at ${TEST_CACHE_MAX_SIZE}`);
    
    // Only the last 5 should remain
    assert.ok(!sequenceCache.has('fiber-0'), 'fiber-0 should be evicted');
    assert.ok(!sequenceCache.has('fiber-14'), 'fiber-14 should be evicted');
    assert.ok(sequenceCache.has('fiber-15'), 'fiber-15 should exist');
    assert.ok(sequenceCache.has('fiber-19'), 'fiber-19 should exist');
  });

});

// Run if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('Running sequence cache unit tests...');
}
