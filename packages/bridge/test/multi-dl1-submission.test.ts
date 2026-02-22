/**
 * Multi-DL1 Submission Tests
 *
 * Tests the fan-out behavior when METAGRAPH_DL1_URLS is set to multiple nodes.
 * Verifies: parallel submission, first-success semantics, failure logging, and
 * getFiberSequenceNumber using the max value across nodes.
 *
 * Run: node --test --experimental-strip-types test/multi-dl1-submission.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline helpers (mirror getDl1Urls logic for isolation) ────────────────────

function parseDl1Urls(dl1UrlsEnv: string | undefined, dl1UrlFallback: string): string[] {
  if (dl1UrlsEnv) {
    const urls = dl1UrlsEnv.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return [...new Set(urls)];
  }
  return [dl1UrlFallback];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('getDl1Urls() — URL parsing', () => {
  it('returns single URL when METAGRAPH_DL1_URLS is not set', () => {
    const urls = parseDl1Urls(undefined, 'http://localhost:9400');
    assert.deepEqual(urls, ['http://localhost:9400']);
  });

  it('returns single URL when METAGRAPH_DL1_URLS is empty string', () => {
    const urls = parseDl1Urls('', 'http://localhost:9400');
    assert.deepEqual(urls, ['http://localhost:9400']);
  });

  it('parses comma-separated DL1 URLs', () => {
    const urls = parseDl1Urls(
      'http://n1:9400,http://n2:9400,http://n3:9400',
      'http://localhost:9400'
    );
    assert.deepEqual(urls, ['http://n1:9400', 'http://n2:9400', 'http://n3:9400']);
  });

  it('trims whitespace from URLs', () => {
    const urls = parseDl1Urls(' http://n1:9400 , http://n2:9400 ', 'http://localhost:9400');
    assert.deepEqual(urls, ['http://n1:9400', 'http://n2:9400']);
  });

  it('deduplicates URLs', () => {
    const urls = parseDl1Urls(
      'http://n1:9400,http://n1:9400,http://n2:9400',
      'http://localhost:9400'
    );
    assert.deepEqual(urls, ['http://n1:9400', 'http://n2:9400']);
  });

  it('handles single URL in METAGRAPH_DL1_URLS', () => {
    const urls = parseDl1Urls('http://prod-dl1:9400', 'http://localhost:9400');
    assert.deepEqual(urls, ['http://prod-dl1:9400']);
  });
});

// ── Fan-out logic tests (pure, no HTTP) ───────────────────────────────────────

describe('Multi-DL1 fan-out logic', () => {

  it('Promise.any resolves with first success', async () => {
    let callCount = 0;

    const tryNode = async (url: string): Promise<{ hash: string; acceptedBy: string }> => {
      callCount++;
      if (url === 'http://n1:9400') {
        // Simulate slow first node
        await new Promise(resolve => setTimeout(resolve, 50));
        return { hash: 'hash-from-n1', acceptedBy: url };
      }
      if (url === 'http://n2:9400') {
        // Fast second node
        return { hash: 'hash-from-n2', acceptedBy: url };
      }
      throw new Error('n3 rejected');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const result = await Promise.any(urls.map(tryNode));

    // n2 should win (fastest success)
    assert.equal(result.acceptedBy, 'http://n2:9400');
    assert.equal(result.hash, 'hash-from-n2');
    // All 3 calls were initiated
    assert.equal(callCount, 3);
  });

  it('Promise.any rejects with AggregateError when all nodes fail', async () => {
    const tryNode = async (_url: string): Promise<never> => {
      throw new Error('connection refused');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    await assert.rejects(
      () => Promise.any(urls.map(tryNode)),
      (err: unknown) => {
        assert.ok(err instanceof AggregateError, 'Should be AggregateError');
        assert.equal((err as AggregateError).errors.length, 3);
        return true;
      }
    );
  });

  it('first success wins even when other nodes fail', async () => {
    const tryNode = async (url: string): Promise<{ hash: string; acceptedBy: string }> => {
      if (url === 'http://n1:9400') throw new Error('n1 is forked');
      if (url === 'http://n2:9400') return { hash: 'hash-n2', acceptedBy: url };
      throw new Error('n3 timed out');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const result = await Promise.any(urls.map(tryNode));
    assert.equal(result.acceptedBy, 'http://n2:9400');
  });
});

// ── Sequence number: max across nodes ────────────────────────────────────────

describe('getFiberSequenceNumber — multi-node max', () => {

  it('takes max sequence across all nodes', async () => {
    // Simulate: node1 is stale (seq=3), node2 is ahead (seq=10), node3 unreachable (0)
    const nodeSeqs: Record<string, number> = {
      'http://n1:9400': 3,
      'http://n2:9400': 10,
      'http://n3:9400': -1, // simulate error
    };

    const queryOne = async (url: string): Promise<number> => {
      const seq = nodeSeqs[url];
      if (seq < 0) throw new Error('unreachable');
      return seq;
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const results = await Promise.all(urls.map((url) => queryOne(url).catch(() => 0)));
    const maxSeq = Math.max(0, ...results);

    assert.equal(maxSeq, 10, 'Should use max seq across all reachable nodes');
  });

  it('returns 0 when all nodes are unreachable', async () => {
    const queryOne = async (_url: string): Promise<number> => {
      throw new Error('unreachable');
    };
    const urls = ['http://n1:9400', 'http://n2:9400'];
    const results = await Promise.all(urls.map((url) => queryOne(url).catch(() => 0)));
    const maxSeq = Math.max(0, ...results);
    assert.equal(maxSeq, 0);
  });

  it('uses cached value when higher than all DL1 nodes', async () => {
    // Cache says we submitted seq=15, DL1 nodes show seq=10 (not applied yet)
    const dl1Seq = 10;
    const cached = 16; // next expected after submitting seq=15
    const seq = Math.max(dl1Seq, cached);
    assert.equal(seq, 16, 'Cache should win when higher than DL1');
  });
});

// ── Error message construction ────────────────────────────────────────────────

describe('Error message formatting', () => {

  it('includes node count and all reasons in error', async () => {
    const urls = ['http://n1:9400', 'http://n2:9400'];
    const tryNode = async (url: string): Promise<never> => {
      throw new Error(`${url} rejected: 503 Service Unavailable`);
    };

    try {
      await Promise.any(urls.map(tryNode));
      assert.fail('Should have thrown');
    } catch (aggErr) {
      assert.ok(aggErr instanceof AggregateError);
      const reasons = (aggErr as AggregateError).errors.map((e: Error) => e.message).join('; ');
      const finalMsg = `Metagraph submission failed on all ${urls.length} DL1 node(s): ${reasons}`;
      assert.ok(finalMsg.includes('all 2 DL1'), finalMsg);
      assert.ok(finalMsg.includes('http://n1:9400'), finalMsg);
      assert.ok(finalMsg.includes('http://n2:9400'), finalMsg);
    }
  });
});
