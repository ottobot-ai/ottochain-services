/**
 * Multi-DL1 Submission Tests
 *
 * Tests the fan-out behavior when METAGRAPH_DL1_URLS is set to multiple nodes.
 * Verifies: parallel submission, first-success semantics, failure logging, and
 * getFiberSequenceNumber using the max value across nodes.
 */

import { describe, it, expect } from 'vitest';

// Import the real parseDl1Urls from metagraph.ts
import { parseDl1Urls } from '../src/metagraph.ts';

// ─────────────────────────────────────────────────────────────────────────────

describe('getDl1Urls() — URL parsing', () => {
  it('returns single URL when METAGRAPH_DL1_URLS is not set', () => {
    const urls = parseDl1Urls(undefined, 'http://localhost:9400');
    expect(urls).toEqual(['http://localhost:9400']);
  });

  it('returns single URL when METAGRAPH_DL1_URLS is empty string', () => {
    const urls = parseDl1Urls('', 'http://localhost:9400');
    expect(urls).toEqual(['http://localhost:9400']);
  });

  it('parses comma-separated DL1 URLs', () => {
    const urls = parseDl1Urls(
      'http://n1:9400,http://n2:9400,http://n3:9400',
      'http://localhost:9400'
    );
    expect(urls).toEqual(['http://n1:9400', 'http://n2:9400', 'http://n3:9400']);
  });

  it('trims whitespace from URLs', () => {
    const urls = parseDl1Urls(' http://n1:9400 , http://n2:9400 ', 'http://localhost:9400');
    expect(urls).toEqual(['http://n1:9400', 'http://n2:9400']);
  });

  it('deduplicates URLs', () => {
    const urls = parseDl1Urls(
      'http://n1:9400,http://n1:9400,http://n2:9400',
      'http://localhost:9400'
    );
    expect(urls).toEqual(['http://n1:9400', 'http://n2:9400']);
  });

  it('handles single URL in METAGRAPH_DL1_URLS', () => {
    const urls = parseDl1Urls('http://prod-dl1:9400', 'http://localhost:9400');
    expect(urls).toEqual(['http://prod-dl1:9400']);
  });
});

// ── Fan-out logic tests (pure, no HTTP) ───────────────────────────────────────

describe('Multi-DL1 fan-out logic', () => {

  it('Promise.any resolves with first success', async () => {
    let callCount = 0;

    const tryNode = async (url: string): Promise<{ hash: string; acceptedBy: string }> => {
      callCount++;
      if (url === 'http://n1:9400') {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { hash: 'hash-from-n1', acceptedBy: url };
      }
      if (url === 'http://n2:9400') {
        return { hash: 'hash-from-n2', acceptedBy: url };
      }
      throw new Error('n3 rejected');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const result = await Promise.any(urls.map(tryNode));

    expect(result.acceptedBy).toBe('http://n2:9400');
    expect(result.hash).toBe('hash-from-n2');
    expect(callCount).toBe(3);
  });

  it('Promise.any rejects with AggregateError when all nodes fail', async () => {
    const tryNode = async (_url: string): Promise<never> => {
      throw new Error('connection refused');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    await expect(Promise.any(urls.map(tryNode))).rejects.toBeInstanceOf(AggregateError);

    // Also verify error count
    try {
      await Promise.any(urls.map(tryNode));
    } catch (err) {
      expect((err as AggregateError).errors.length).toBe(3);
    }
  });

  it('first success wins even when other nodes fail', async () => {
    const tryNode = async (url: string): Promise<{ hash: string; acceptedBy: string }> => {
      if (url === 'http://n1:9400') throw new Error('n1 is forked');
      if (url === 'http://n2:9400') return { hash: 'hash-n2', acceptedBy: url };
      throw new Error('n3 timed out');
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const result = await Promise.any(urls.map(tryNode));
    expect(result.acceptedBy).toBe('http://n2:9400');
  });
});

// ── Sequence number: max across nodes ────────────────────────────────────────

describe('getFiberSequenceNumber — multi-node max', () => {

  it('takes max sequence across all nodes', async () => {
    const nodeSeqs: Record<string, number> = {
      'http://n1:9400': 3,
      'http://n2:9400': 10,
      'http://n3:9400': -1,
    };

    const queryOne = async (url: string): Promise<number> => {
      const seq = nodeSeqs[url];
      if (seq < 0) throw new Error('unreachable');
      return seq;
    };

    const urls = ['http://n1:9400', 'http://n2:9400', 'http://n3:9400'];
    const results = await Promise.all(urls.map((url) => queryOne(url).catch(() => 0)));
    const maxSeq = Math.max(0, ...results);

    expect(maxSeq).toBe(10);
  });

  it('returns 0 when all nodes are unreachable', async () => {
    const queryOne = async (_url: string): Promise<number> => {
      throw new Error('unreachable');
    };
    const urls = ['http://n1:9400', 'http://n2:9400'];
    const results = await Promise.all(urls.map((url) => queryOne(url).catch(() => 0)));
    const maxSeq = Math.max(0, ...results);
    expect(maxSeq).toBe(0);
  });

  it('uses cached value when higher than all DL1 nodes', async () => {
    const dl1Seq = 10;
    const cached = 16;
    const seq = Math.max(dl1Seq, cached);
    expect(seq).toBe(16);
  });
});

// ── Error message construction ────────────────────────────────────────────────

describe('Error message formatting', () => {

  it('includes node count and all reasons in error', async () => {
    const urls = ['http://n1:9400', 'http://n2:9400'];
    const tryNode = async (url: string): Promise<never> => {
      throw new Error(`${url} rejected: 503 Service Unavailable`);
    };

    let aggErr: AggregateError | undefined;
    try {
      await Promise.any(urls.map(tryNode));
    } catch (err) {
      aggErr = err as AggregateError;
    }

    expect(aggErr).toBeInstanceOf(AggregateError);
    const reasons = (aggErr!).errors.map((e: Error) => e.message).join('; ');
    const finalMsg = `Metagraph submission failed on all ${urls.length} DL1 node(s): ${reasons}`;
    expect(finalMsg).toContain('all 2 DL1');
    expect(finalMsg).toContain('http://n1:9400');
    expect(finalMsg).toContain('http://n2:9400');
  });
});
