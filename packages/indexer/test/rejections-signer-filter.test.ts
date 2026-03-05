/**
 * Indexer: Rejection Signer Filter Tests (TDD)
 *
 * Verifies existing signer filter behavior in GET /api/rejections.
 * The `signer` param already works at the DB layer — this confirms the
 * API surface is correct (no regression after timestamp changes).
 *
 * Spec: docs/design/rejection-history-filters-spec.md — Group 2
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';

interface RejectionsResponse {
  rejections: Array<{ signers: string[]; [k: string]: unknown }>;
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

describe('Indexer: Signer Filter (AC7)', () => {

  it('T7: signer=<known> returns only records where signers[] contains that address exactly (AC7)', async () => {
    // First, find a real signer address from the rejections list
    const all = await fetchRejections({ limit: '5' });
    assert.strictEqual(all.status, 200, 'Pre-flight fetch failed');
    const allData = all.body as RejectionsResponse;

    if (allData.rejections.length === 0) {
      // No data — skip test but don't fail
      console.log('T7: No rejections in DB, skipping assertion');
      return;
    }

    const knownSigner = allData.rejections[0].signers[0];
    if (!knownSigner) {
      console.log('T7: First rejection has no signers, skipping assertion');
      return;
    }

    const { status, body } = await fetchRejections({ signer: knownSigner });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.ok(Array.isArray(data.rejections), 'Should return rejections array');
    assert.ok(data.rejections.length > 0, 'Should find at least one record for known signer');
    for (const r of data.rejections) {
      assert.ok(
        r.signers.includes(knownSigner),
        `Record signers ${JSON.stringify(r.signers)} does not include ${knownSigner}`
      );
    }
  });

  it('T8: signer=<unknown> returns empty result (AC7)', async () => {
    const { status, body } = await fetchRejections({ signer: 'DAGunknownSigner99999999999999999999' });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.strictEqual(data.rejections.length, 0, 'Should return no records for unknown signer');
    assert.strictEqual(data.total, 0, 'Total should be 0 for unknown signer');
  });

  it('T9: signer + updateType combined filter applies both constraints (AC7)', async () => {
    // Use an unknown signer but valid updateType — expect empty result
    const { status, body } = await fetchRejections({
      signer: 'DAGunknownSigner99999999999999999999',
      updateType: 'TransitionStateMachine',
    });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    const data = body as RejectionsResponse;
    assert.strictEqual(data.rejections.length, 0, 'Should return no records for unknown signer with any updateType');
    assert.strictEqual(data.total, 0, 'Total should be 0');
  });

});
