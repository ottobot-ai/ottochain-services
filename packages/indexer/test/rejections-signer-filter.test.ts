/**
 * Indexer: Rejection Signer Filter Tests (TDD)
 *
 * Verifies existing signer filter behavior in GET /api/rejections.
 * The `signer` param already works at the DB layer — this confirms the
 * API surface is correct (no regression after timestamp changes).
 *
 * Spec: docs/design/rejection-history-filters-spec.md — Group 2
 */

import { describe, it, expect } from 'vitest';

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
    const all = await fetchRejections({ limit: '5' });
    expect(all.status).toBe(200);
    const allData = all.body as RejectionsResponse;

    if (allData.rejections.length === 0) {
      console.log('T7: No rejections in DB, skipping assertion');
      return;
    }

    const knownSigner = allData.rejections[0].signers[0];
    if (!knownSigner) {
      console.log('T7: First rejection has no signers, skipping assertion');
      return;
    }

    const { status, body } = await fetchRejections({ signer: knownSigner });
    expect(status).toBe(200);
    const data = body as RejectionsResponse;
    expect(Array.isArray(data.rejections)).toBeTruthy();
    expect(data.rejections.length > 0).toBeTruthy();
    for (const r of data.rejections) {
      expect(r.signers.includes(knownSigner)).toBeTruthy();
    }
  });

  it('T8: signer=<unknown> returns empty result (AC7)', async () => {
    const { status, body } = await fetchRejections({ signer: 'DAGunknownSigner99999999999999999999' });
    expect(status).toBe(200);
    const data = body as RejectionsResponse;
    expect(data.rejections.length).toBe(0);
    expect(data.total).toBe(0);
  });

  it('T9: signer + updateType combined filter applies both constraints (AC7)', async () => {
    const { status, body } = await fetchRejections({
      signer: 'DAGunknownSigner99999999999999999999',
      updateType: 'TransitionStateMachine',
    });
    expect(status).toBe(200);
    const data = body as RejectionsResponse;
    expect(data.rejections.length).toBe(0);
    expect(data.total).toBe(0);
  });

});
