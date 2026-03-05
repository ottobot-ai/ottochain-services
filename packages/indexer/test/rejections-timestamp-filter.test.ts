/**
 * Indexer: Rejection Timestamp Range Filter Tests (TDD)
 *
 * Tests for the timestamp_from / timestamp_to query parameters added to
 * GET /api/rejections. These are integration tests requiring a live indexer.
 *
 * Spec: docs/design/rejection-history-filters-spec.md — Group 1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';

interface RejectionsResponse {
  rejections: unknown[];
  total: number;
  hasMore: boolean;
}

async function fetchRejections(params: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const qs = new URLSearchParams(params).toString();
  const url = `${INDEXER_URL}/api/rejections${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('Indexer: Timestamp Range Filter (AC1–AC5)', () => {

  it('T1: timestamp_from returns only records with timestamp >= lower bound (AC1)', async () => {
    const { status, body } = await fetchRejections({
      timestamp_from: '2026-02-01T00:00:00Z',
      limit: '10',
    });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.ok(Array.isArray(data.rejections), 'Should return rejections array');
    // Verify all returned records have timestamp >= lower bound
    const lowerBound = new Date('2026-02-01T00:00:00Z');
    for (const r of data.rejections as Array<{ timestamp: string }>) {
      assert.ok(
        new Date(r.timestamp) >= lowerBound,
        `Record timestamp ${r.timestamp} is before lower bound 2026-02-01`
      );
    }
  });

  it('T2: timestamp_to returns only records with timestamp <= upper bound (AC2)', async () => {
    const { status, body } = await fetchRejections({
      timestamp_to: '2026-02-10T23:59:59Z',
      limit: '10',
    });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.ok(Array.isArray(data.rejections), 'Should return rejections array');
    const upperBound = new Date('2026-02-10T23:59:59Z');
    for (const r of data.rejections as Array<{ timestamp: string }>) {
      assert.ok(
        new Date(r.timestamp) <= upperBound,
        `Record timestamp ${r.timestamp} is after upper bound 2026-02-10`
      );
    }
  });

  it('T3: combined timestamp_from + timestamp_to returns records in closed interval (AC3)', async () => {
    const { status, body } = await fetchRejections({
      timestamp_from: '2026-02-01T00:00:00Z',
      timestamp_to: '2026-02-10T23:59:59Z',
      limit: '10',
    });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.ok(Array.isArray(data.rejections), 'Should return rejections array');
    const lower = new Date('2026-02-01T00:00:00Z');
    const upper = new Date('2026-02-10T23:59:59Z');
    for (const r of data.rejections as Array<{ timestamp: string }>) {
      const ts = new Date(r.timestamp);
      assert.ok(ts >= lower && ts <= upper,
        `Record timestamp ${r.timestamp} is outside [Feb 1, Feb 10] interval`
      );
    }
  });

  it('T4: invalid timestamp_from returns 400 Bad Request (AC4)', async () => {
    const { status, body } = await fetchRejections({ timestamp_from: 'not-a-date' });
    assert.strictEqual(status, 400, `Expected 400, got ${status}`);
    const data = body as { error: string };
    assert.ok(
      typeof data.error === 'string' && data.error.includes('timestamp_from'),
      `Expected error mentioning "timestamp_from", got: ${JSON.stringify(data)}`
    );
  });

  it('T5: invalid timestamp_to returns 400 Bad Request (AC4)', async () => {
    const { status, body } = await fetchRejections({ timestamp_to: 'also-not-a-date' });
    assert.strictEqual(status, 400, `Expected 400, got ${status}`);
    const data = body as { error: string };
    assert.ok(
      typeof data.error === 'string' && data.error.includes('timestamp_to'),
      `Expected error mentioning "timestamp_to", got: ${JSON.stringify(data)}`
    );
  });

  it('T6: future timestamp_from returns empty result set (AC5)', async () => {
    const { status, body } = await fetchRejections({ timestamp_from: '2030-01-01T00:00:00Z' });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.deepStrictEqual(
      { rejections: data.rejections, total: data.total, hasMore: data.hasMore },
      { rejections: [], total: 0, hasMore: false },
      'Future timestamp_from should return empty result'
    );
  });

});
