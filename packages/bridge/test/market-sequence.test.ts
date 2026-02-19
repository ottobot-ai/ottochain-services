/**
 * Regression Test: Bridge Sequence Number Tracking (Issue #109)
 *
 * Verifies that rapid successive transactions to the same market fiber
 * each use an incrementing targetSequenceNumber rather than the same stale value.
 *
 * Before the fix, all transitions after the first returned the same seq (0 or N)
 * because DL1 hadn't updated its onchain fiberCommits by the time the next route
 * handler called getFiberSequenceNumber(). The fix adds waitForSequence() after
 * each submitTransaction(), ensuring DL1 confirms the increment before the
 * response is sent — so the next call always reads an up-to-date sequence.
 *
 * Requires a running OttoChain cluster + bridge:
 *   BRIDGE_URL=http://localhost:3030
 *   ML0_URL=http://localhost:9200
 *   DL1_URL=http://localhost:9300
 *
 * Run:
 *   pnpm test:sequence
 *   # or
 *   node --test --experimental-strip-types test/market-sequence.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL    = process.env.ML0_URL    || 'http://localhost:9200';
const DL1_URL    = process.env.DL1_URL    || 'http://localhost:9300';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Wallet {
  privateKey: string;
  publicKey:  string;
  address:    string;
}

interface OnChainState {
  fiberCommits?: Record<string, { sequenceNumber?: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}: ${text}`);
  return JSON.parse(text) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(`${BRIDGE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

async function makeWallet(): Promise<Wallet> {
  return fetchJson<Wallet>(`${BRIDGE_URL}/agent/wallet`, { method: 'POST' });
}

/** Get the DL1 onchain sequence number for a fiber (0 if not yet committed). */
async function dl1Sequence(fiberId: string): Promise<number> {
  try {
    const onChain = await fetchJson<OnChainState>(
      `${DL1_URL}/data-application/v1/onchain`
    );
    return onChain?.fiberCommits?.[fiberId]?.sequenceNumber ?? 0;
  } catch {
    return 0;
  }
}

/** Poll ML0 until state machine is in the expected state, or timeout. */
async function waitForState(
  fiberId: string,
  expectedState: string,
  timeoutMs = 45_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (res.ok) {
        const sm = await res.json() as { currentState?: { value?: string } };
        if (sm.currentState?.value === expectedState) return true;
      }
    } catch { /* cluster not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// Regression: rapid successive transactions should not reuse the same sequence
// ═════════════════════════════════════════════════════════════════════════════

describe('Market sequence number tracking (regression #109)', () => {
  let wallet: Wallet;
  let marketId: string;

  before(async () => {
    wallet = await makeWallet();
    console.log(`  Wallet: ${wallet.address}`);
  });

  it('should create a prediction market', async () => {
    const result = await post<{ marketId: string; hash: string }>('/market/create', {
      privateKey:  wallet.privateKey,
      marketType:  'prediction',
      title:       'Sequence regression test market',
      description: 'Verifies that rapid transitions use distinct sequence numbers',
      terms: {
        question: 'Will the sequence bug be fixed?',
        outcomes: ['yes', 'no'],
      },
    });

    assert.ok(result.marketId, 'Missing marketId');
    assert.ok(result.hash,     'Missing hash');
    marketId = result.marketId;
    console.log(`  ✓ Market created: ${marketId}`);
  });

  it('should open the market — DL1 sequence should advance to 1', async () => {
    const result = await post<{ hash: string; status: string }>('/market/open', {
      privateKey: wallet.privateKey,
      marketId,
    });

    assert.ok(result.hash, 'Missing hash from /market/open');
    assert.strictEqual(result.status, 'OPEN', `Expected status OPEN, got ${result.status}`);

    // After /market/open returns, the fix guarantees DL1 has already processed
    // the open transition. Sequence should now be 1.
    const seq = await dl1Sequence(marketId);
    assert.strictEqual(
      seq, 1,
      `DL1 sequence should be 1 after open, got ${seq} — sequence not yet propagated`
    );
    console.log(`  ✓ Market opened; DL1 sequence = ${seq}`);
  });

  it('should commit agent1 — DL1 sequence should advance to 2', async () => {
    const agent1 = await makeWallet();

    const result = await post<{ hash: string; amount: number }>('/market/commit', {
      privateKey: agent1.privateKey,
      marketId,
      amount: 10,
      data: { outcome: 'yes' },
    });

    assert.ok(result.hash,   'Missing hash from /market/commit (agent1)');
    assert.strictEqual(result.amount, 10, 'Wrong amount returned');

    const seq = await dl1Sequence(marketId);
    assert.strictEqual(
      seq, 2,
      `DL1 sequence should be 2 after commit agent1, got ${seq} — REGRESSION: duplicate sequence!`
    );
    console.log(`  ✓ Agent1 committed; DL1 sequence = ${seq}`);
  });

  it('should commit agent2 immediately after — DL1 sequence should advance to 3', async () => {
    // This is the core of the regression: submit agent2's commit WITHOUT any
    // manual sleep. Before the fix, the bridge would still see seq=1 from DL1
    // and send targetSequenceNumber=1, colliding with agent1's commit.
    const agent2 = await makeWallet();

    const result = await post<{ hash: string }>('/market/commit', {
      privateKey: agent2.privateKey,
      marketId,
      amount: 5,
      data: { outcome: 'no' },
    });

    assert.ok(result.hash, 'Missing hash from /market/commit (agent2)');

    const seq = await dl1Sequence(marketId);
    assert.strictEqual(
      seq, 3,
      `DL1 sequence should be 3 after commit agent2, got ${seq} — REGRESSION: duplicate sequence!`
    );
    console.log(`  ✓ Agent2 committed (no sleep between commits); DL1 sequence = ${seq}`);
  });

  it('should close the market — DL1 sequence should advance to 4', async () => {
    const result = await post<{ hash: string; status: string }>('/market/close', {
      privateKey: wallet.privateKey,
      marketId,
    });

    assert.ok(result.hash, 'Missing hash from /market/close');
    assert.strictEqual(result.status, 'CLOSED', `Expected status CLOSED, got ${result.status}`);

    const seq = await dl1Sequence(marketId);
    assert.strictEqual(
      seq, 4,
      `DL1 sequence should be 4 after close, got ${seq} — REGRESSION: duplicate sequence!`
    );
    console.log(`  ✓ Market closed; DL1 sequence = ${seq}`);
  });

  it('full lifecycle completes on ML0 with CLOSED state', async () => {
    const reached = await waitForState(marketId, 'CLOSED');
    assert.ok(
      reached,
      `Market ${marketId} did not reach CLOSED on ML0 within timeout — ` +
      `some transactions were likely rejected due to sequence mismatch`
    );
    console.log(`  ✓ Market CLOSED on ML0 — all transitions accepted, sequence tracking verified ✨`);
  });
});
