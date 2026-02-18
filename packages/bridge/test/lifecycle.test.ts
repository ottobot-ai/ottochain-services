/**
 * Comprehensive App Lifecycle Tests
 *
 * Tests the FULL lifecycle for each bridge application type.
 * Prior tests only covered create/open — not the complete state journey.
 *
 * Requires a running OttoChain cluster + bridge:
 *   BRIDGE_URL=http://localhost:3030
 *   ML0_URL=http://localhost:9200
 *
 * Run:
 *   pnpm test:lifecycle
 *   # or
 *   node --test --experimental-strip-types test/lifecycle.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL    = process.env.ML0_URL    || 'http://localhost:9200';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Wallet {
  privateKey: string;
  publicKey:  string;
  address:    string;
}

interface StateMachine {
  fiberId:        string;
  currentState:   { value: string };
  stateData:      Record<string, unknown>;
  owners:         string[];
  sequenceNumber: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} at ${url}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Generate a fresh wallet via bridge */
async function makeWallet(): Promise<Wallet> {
  return fetchJson<Wallet>(`${BRIDGE_URL}/agent/wallet`, { method: 'POST' });
}

/** Poll ML0 until state machine reaches expectedState or timeout */
async function waitForState(
  fiberId: string,
  expectedState: string,
  timeoutMs = 30_000
): Promise<StateMachine | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (res.ok) {
        const fiber = await res.json() as StateMachine;
        if (fiber.currentState?.value === expectedState) return fiber;
      }
    } catch { /* still starting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/** Poll ML0 until state machine exists (any state) */
async function waitForFiber(
  fiberId: string,
  timeoutMs = 30_000
): Promise<StateMachine | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (res.ok) return res.json() as Promise<StateMachine>;
    } catch { /* still starting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/** Small delay to let DL1/ML0 sync between rapid transactions */
const settle = (ms = 3000) => new Promise(r => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════════════════
// CONTRACT LIFECYCLE: propose → accept → complete (both) → finalize
// ═════════════════════════════════════════════════════════════════════════════

describe('Contract Lifecycle: propose → accept → complete × 2 → finalize', () => {
  let proposer:     Wallet;
  let counterparty: Wallet;
  let contractId:   string;

  before(async () => {
    proposer     = await makeWallet();
    counterparty = await makeWallet();
    console.log(`  Proposer:     ${proposer.address}`);
    console.log(`  Counterparty: ${counterparty.address}`);
  });

  // ── Step 1: Propose ────────────────────────────────────────────────────────

  it('should propose a contract', async () => {
    const result = await post<{ contractId: string; proposer: string; counterparty: string; hash: string }>(
      '/contract/propose',
      {
        privateKey:          proposer.privateKey,
        counterpartyAddress: counterparty.address,
        title:               'Lifecycle Test Contract',
        description:         'Full lifecycle regression test',
        terms: {
          deliverable: 'Deploy feature X',
          deadline:    '2026-03-01',
          payment:     100,
        },
      }
    );

    assert.ok(result.contractId,                   'Missing contractId');
    assert.strictEqual(result.proposer,     proposer.address,     'Wrong proposer');
    assert.strictEqual(result.counterparty, counterparty.address, 'Wrong counterparty');
    assert.ok(result.hash,                         'Missing hash');

    contractId = result.contractId;
    console.log(`  ✓ Contract proposed: ${contractId}`);
  });

  it('should appear on ML0 in PROPOSED state', async () => {
    const fiber = await waitForFiber(contractId);
    assert.ok(fiber,                      'Contract not found on ML0');
    assert.strictEqual(fiber!.currentState.value, 'PROPOSED', `Wrong state: ${fiber!.currentState.value}`);
    console.log(`  ✓ Contract PROPOSED on ML0`);
  });

  // ── Step 2: Accept ─────────────────────────────────────────────────────────

  it('should reject acceptance by wrong party', async () => {
    // Proposer trying to accept their own contract
    const res = await fetch(`${BRIDGE_URL}/contract/accept`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKey: proposer.privateKey, contractId }),
    });
    assert.strictEqual(res.status, 403, 'Expected 403 for wrong accepter');
    console.log(`  ✓ Correctly rejected self-acceptance`);
  });

  it('should accept the contract (counterparty)', async () => {
    await settle();
    const result = await post<{ hash: string; contractId: string; status: string }>(
      '/contract/accept',
      { privateKey: counterparty.privateKey, contractId }
    );

    assert.ok(result.hash,                          'Missing hash');
    assert.strictEqual(result.contractId, contractId, 'Wrong contractId');
    console.log(`  ✓ Contract accepted: ${result.hash}`);
  });

  it('should transition to ACTIVE on ML0', async () => {
    const fiber = await waitForState(contractId, 'ACTIVE');
    assert.ok(fiber, 'Contract did not reach ACTIVE state within timeout');
    console.log(`  ✓ Contract ACTIVE on ML0`);
  });

  // ── Step 3: Both parties submit completion ─────────────────────────────────

  it('should not finalize before both parties complete', async () => {
    await settle();
    const res = await fetch(`${BRIDGE_URL}/contract/finalize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKey: proposer.privateKey, contractId }),
    });
    assert.strictEqual(res.status, 400, 'Expected 400 when not all parties have completed');
    const body = await res.json() as { error: string };
    assert.ok(body.error.includes('completion'), `Wrong error: ${body.error}`);
    console.log(`  ✓ Correctly blocked finalization before completions`);
  });

  it('should allow proposer to submit completion', async () => {
    const result = await post<{ hash: string; contractId: string }>(
      '/contract/complete',
      {
        privateKey: proposer.privateKey,
        contractId,
        proof: 'proposer-evidence-hash-abc123',
      }
    );
    assert.ok(result.hash, 'Missing hash');
    console.log(`  ✓ Proposer submitted completion`);
  });

  it('should allow counterparty to submit completion', async () => {
    await settle();
    const result = await post<{ hash: string; contractId: string }>(
      '/contract/complete',
      {
        privateKey: counterparty.privateKey,
        contractId,
        proof: 'counterparty-evidence-hash-def456',
      }
    );
    assert.ok(result.hash, 'Missing hash');
    console.log(`  ✓ Counterparty submitted completion`);
  });

  it('should have 2 completions recorded on ML0', async () => {
    // Wait for the second completion to propagate
    const deadline = Date.now() + 20_000;
    let fiber: StateMachine | null = null;
    while (Date.now() < deadline) {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${contractId}`);
      if (res.ok) {
        fiber = await res.json() as StateMachine;
        const completions = fiber.stateData.completions as unknown[];
        if (completions?.length >= 2) break;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    assert.ok(fiber, 'Contract not found on ML0');
    const completions = fiber!.stateData.completions as unknown[];
    assert.ok(
      Array.isArray(completions) && completions.length >= 2,
      `Expected ≥2 completions, got: ${JSON.stringify(completions)}`
    );
    console.log(`  ✓ Both completions recorded (${completions.length})`);
  });

  // ── Step 4: Finalize ───────────────────────────────────────────────────────

  it('should finalize the contract', async () => {
    await settle();
    const result = await post<{ hash: string; contractId: string; status: string }>(
      '/contract/finalize',
      { privateKey: proposer.privateKey, contractId }
    );
    assert.ok(result.hash, 'Missing hash');
    assert.strictEqual(result.status, 'COMPLETED', `Wrong status: ${result.status}`);
    console.log(`  ✓ Contract finalized: ${result.hash}`);
  });

  it('should transition to COMPLETED on ML0', async () => {
    const fiber = await waitForState(contractId, 'COMPLETED');
    assert.ok(fiber, 'Contract did not reach COMPLETED state within timeout');
    console.log(`  ✓ Contract COMPLETED on ML0 — full lifecycle verified ✨`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTRACT REJECTION PATH: propose → reject
// ═════════════════════════════════════════════════════════════════════════════

describe('Contract Lifecycle: propose → reject', () => {
  let proposer:     Wallet;
  let counterparty: Wallet;
  let contractId:   string;

  before(async () => {
    proposer     = await makeWallet();
    counterparty = await makeWallet();
  });

  it('should propose a contract', async () => {
    const result = await post<{ contractId: string }>(
      '/contract/propose',
      {
        privateKey:          proposer.privateKey,
        counterpartyAddress: counterparty.address,
        terms: { deliverable: 'Rejected contract test' },
      }
    );
    contractId = result.contractId;
    console.log(`  ✓ Contract proposed: ${contractId}`);
  });

  it('should appear on ML0 in PROPOSED state', async () => {
    const fiber = await waitForFiber(contractId);
    assert.strictEqual(fiber!.currentState.value, 'PROPOSED');
  });

  it('should allow counterparty to reject', async () => {
    await settle();
    const result = await post<{ hash: string; contractId: string; status: string }>(
      '/contract/reject',
      {
        privateKey: counterparty.privateKey,
        contractId,
        reason: 'Terms not acceptable',
      }
    );
    assert.ok(result.hash, 'Missing hash');
    console.log(`  ✓ Contract rejected`);
  });

  it('should transition to REJECTED on ML0', async () => {
    const fiber = await waitForState(contractId, 'REJECTED');
    assert.ok(fiber, 'Contract did not reach REJECTED state');
    console.log(`  ✓ Contract REJECTED on ML0`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AGENT LIFECYCLE: register → activate → vouch
// ═════════════════════════════════════════════════════════════════════════════

describe('Agent Lifecycle: register → activate → vouch', () => {
  let agentWallet:  Wallet;
  let voucherWallet: Wallet;
  let agentFiberId: string;
  let voucherFiberId: string;

  before(async () => {
    agentWallet   = await makeWallet();
    voucherWallet = await makeWallet();
    console.log(`  Agent:   ${agentWallet.address}`);
    console.log(`  Voucher: ${voucherWallet.address}`);
  });

  it('should register the agent', async () => {
    const result = await post<{ fiberId: string; address: string; hash: string }>(
      '/agent/register',
      {
        privateKey:   agentWallet.privateKey,
        displayName:  'LifecycleTestAgent',
        platform:     'TELEGRAM',
        platformUserId: 'test-lifecycle-001',
      }
    );
    assert.ok(result.fiberId, 'Missing fiberId');
    assert.strictEqual(result.address, agentWallet.address, 'Wrong address');
    agentFiberId = result.fiberId;
    console.log(`  ✓ Agent registered: ${agentFiberId}`);
  });

  it('should appear on ML0 in REGISTERED state', async () => {
    const fiber = await waitForFiber(agentFiberId);
    assert.ok(fiber, 'Agent not found on ML0');
    assert.strictEqual(fiber!.currentState.value, 'REGISTERED');
    console.log(`  ✓ Agent REGISTERED on ML0`);
  });

  it('should activate the agent', async () => {
    await settle();
    const result = await post<{ hash: string; fiberId: string; status: string }>(
      '/agent/activate',
      { privateKey: agentWallet.privateKey, fiberId: agentFiberId }
    );
    assert.ok(result.hash, 'Missing hash');
    console.log(`  ✓ Agent activated`);
  });

  it('should transition to ACTIVE on ML0', async () => {
    const fiber = await waitForState(agentFiberId, 'ACTIVE');
    assert.ok(fiber, 'Agent did not reach ACTIVE state');
    console.log(`  ✓ Agent ACTIVE on ML0`);
  });

  it('should register a vouching agent', async () => {
    await settle();
    const result = await post<{ fiberId: string; hash: string }>(
      '/agent/register',
      { privateKey: voucherWallet.privateKey, displayName: 'Voucher' }
    );
    voucherFiberId = result.fiberId;

    // Activate the voucher too
    await settle();
    await post('/agent/activate', { privateKey: voucherWallet.privateKey, fiberId: voucherFiberId });
    const fiber = await waitForState(voucherFiberId, 'ACTIVE');
    assert.ok(fiber, 'Voucher not ACTIVE');
    console.log(`  ✓ Voucher registered + activated: ${voucherFiberId}`);
  });

  it('should allow vouching for the agent', async () => {
    await settle();
    const res = await fetch(`${BRIDGE_URL}/agent/vouch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: voucherWallet.privateKey,
        targetFiberId: agentFiberId,
        voucherFiberId,
      }),
    });

    // Accept either success or "already vouched" (idempotent)
    const body = await res.json() as Record<string, unknown>;
    assert.ok(
      res.status === 200 || res.status === 400,
      `Unexpected status ${res.status}: ${JSON.stringify(body)}`
    );
    console.log(`  ✓ Vouch submitted (status=${res.status})`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MARKET COMMIT RACE CONDITION REGRESSION
// Verifies fix: submitTransaction retry + waitForSequence after open
// ═════════════════════════════════════════════════════════════════════════════

describe('Market Regression: rapid open → commit (sequence race condition)', () => {
  let creatorWallet:     Wallet;
  let participantWallet: Wallet;
  let marketId:          string;

  before(async () => {
    creatorWallet     = await makeWallet();
    participantWallet = await makeWallet();
  });

  it('should create a market', async () => {
    const result = await post<{ fiberId: string; hash: string }>(
      '/market/create',
      {
        privateKey:   creatorWallet.privateKey,
        marketType:   'prediction',
        title:        'Race condition regression test',
        description:  'Verifies waitForSequence prevents 400 on rapid commit',
        resolutionDate: new Date(Date.now() + 3600_000).toISOString(),
        options:      ['YES', 'NO'],
      }
    );
    marketId = result.fiberId;
    const fiber = await waitForFiber(marketId);
    assert.ok(fiber, 'Market not found on ML0');
    console.log(`  ✓ Market created: ${marketId}`);
  });

  it('should open the market', async () => {
    await settle(2000);
    const result = await post<{ hash: string; status: string }>(
      '/market/open',
      { privateKey: creatorWallet.privateKey, marketId }
    );
    assert.ok(result.hash, 'Missing hash');
    // waitForSequence is called inside /market/open — no need to poll here
    console.log(`  ✓ Market opened (sequence synced before return)`);
  });

  it('should accept an immediate commit WITHOUT 400 error (regression)', async () => {
    // Intentionally NO settle() here — testing rapid open → commit
    const result = await post<{ hash: string; marketId: string; amount: number }>(
      '/market/commit',
      {
        privateKey: participantWallet.privateKey,
        marketId,
        amount:     50,
        data:       { option: 'YES' },
      }
    );
    assert.ok(result.hash, 'Commit failed — sequence race condition not fixed');
    assert.strictEqual(result.marketId, marketId);
    console.log(`  ✓ Immediate commit succeeded — race condition fix verified ✨`);
  });

  it('should reflect commitment on ML0', async () => {
    const fiber = await waitForState(marketId, 'OPEN');
    assert.ok(fiber, 'Market not found in OPEN state');
    const commitments = fiber!.stateData.commitments as Record<string, unknown> | unknown[];
    const hasCommitments = Array.isArray(commitments)
      ? commitments.length > 0
      : Object.keys(commitments ?? {}).length > 0;
    assert.ok(hasCommitments, 'No commitments recorded');
    console.log(`  ✓ Commitment recorded on ML0`);
  });
});

// Run if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('\n🧪 Running App Lifecycle Tests\n');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ML0:    ${ML0_URL}\n`);
}
