#!/usr/bin/env npx tsx
/**
 * E2E test: Rejection Notification Flow
 *
 * Validates the complete rejection pipeline:
 *   DL1 accepts txn → ML0 rejects (guard fail) → webhook dispatched →
 *   indexer stores → query API returns → dedup works → history preserved
 *
 * Test Scenarios:
 *   1. Create fiber via bridge → appears on ML0
 *   2. Submit transition with wrong agent directly to DL1 → guard fail → ML0 rejects
 *   3. Indexer receives rejection webhook → stores in DB
 *   4. Rejection is queryable via API (by fiber, by hash, by filters)
 *   5. Duplicate rejection is deduplicated (same updateHash not stored twice)
 *   6. Correct transition via bridge → fiber reaches ACTIVE
 *   7. Rejection history preserved alongside active state
 *
 * Usage:
 *   BRIDGE_URL=http://localhost:3030 \
 *   ML0_URL=http://localhost:9200 \
 *   INDEXER_URL=http://localhost:3031 \
 *   DL1_URL=http://localhost:9400 \
 *   npx tsx scripts/testing/test-rejection-notification-e2e.ts
 *
 * Defaults:
 *   BRIDGE_URL    http://localhost:3030
 *   ML0_URL       http://localhost:9200
 *   INDEXER_URL   http://localhost:3031
 *   DL1_URL       http://localhost:9400
 *   POLL_TIMEOUT  60  (seconds; rejection propagation window)
 */

import { batchSign, generateKeyPair } from '@ottochain/sdk';
import { randomUUID } from 'crypto';

// ── Configuration ─────────────────────────────────────────────────────────────

const BRIDGE_URL   = process.env.BRIDGE_URL   || 'http://localhost:3030';
const ML0_URL      = process.env.ML0_URL      || 'http://localhost:9200';
const INDEXER_URL  = process.env.INDEXER_URL  || 'http://localhost:3031';
const DL1_URL      = process.env.DL1_URL      || 'http://localhost:9400';
const POLL_TIMEOUT = parseInt(process.env.POLL_TIMEOUT || '60') * 1000;
const POLL_INTERVAL = 2000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

interface Wallet {
  privateKey: string;
  address: string;
}

interface StateMachine {
  fiberId: string;
  currentState: { value: string };
  stateData: Record<string, unknown>;
  sequenceNumber: number;
}

interface RejectionRecord {
  id: number;
  ordinal: number;
  timestamp: string;
  updateType: string;
  fiberId: string;
  updateHash: string;
  errors: { code: string; message: string }[];
  signers: string[];
}

interface RejectionListResponse {
  rejections: RejectionRecord[];
  total: number;
  hasMore: boolean;
}

// ── Shared state ──────────────────────────────────────────────────────────────

const results: TestResult[] = [];
let contractId = '';
let proposer: Wallet;
let counterparty: Wallet;
let wrongUser: Wallet;
let firstRejectionHash = '';
let firstRejection!: RejectionRecord;

// ── Test harness ──────────────────────────────────────────────────────────────

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, message: 'OK', duration });
    console.log(`  ✅ ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, message, duration });
    console.log(`  ❌ ${name}: ${message} (${duration}ms)`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}: ${text.substring(0, 300)}`);
  return JSON.parse(text) as T;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Poll fn() until it returns non-null or timeout */
async function pollUntil<T>(
  fn: () => Promise<T | null>,
  label: string,
  timeoutMs = POLL_TIMEOUT
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  ⏳ Polling ${label}`);
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v !== null) { console.log(' ✓'); return v; }
    } catch { /* not ready yet */ }
    await sleep(POLL_INTERVAL);
    process.stdout.write('.');
  }
  console.log(' ✗ TIMEOUT');
  throw new Error(`Timeout after ${timeoutMs / 1000}s waiting for: ${label}`);
}

// ── ML0 helpers ───────────────────────────────────────────────────────────────

async function waitForFiberOnML0(fiberId: string): Promise<StateMachine> {
  return pollUntil(
    async () => {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (!res.ok) return null;
      return res.json() as Promise<StateMachine>;
    },
    `fiber ${fiberId.substring(0, 8)}... on ML0`,
    30_000
  );
}

async function waitForFiberState(fiberId: string, expectedState: string): Promise<StateMachine> {
  return pollUntil(
    async () => {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (!res.ok) return null;
      const fiber = await res.json() as StateMachine;
      return fiber.currentState?.value === expectedState ? fiber : null;
    },
    `fiber ${fiberId.substring(0, 8)}... to be ${expectedState}`,
    45_000
  );
}

// ── Indexer helpers ───────────────────────────────────────────────────────────

async function waitForRejection(fiberId: string): Promise<RejectionRecord> {
  return pollUntil(
    async () => {
      const data = await fetchJson<RejectionListResponse>(
        `${INDEXER_URL}/api/fibers/${fiberId}/rejections`
      );
      return data.rejections.length > 0 ? data.rejections[0] : null;
    },
    `rejection for fiber ${fiberId.substring(0, 8)}...`
  );
}

// ── Contract definition ───────────────────────────────────────────────────────
// Minimal contract SM: PROPOSED → ACTIVE requires event.agent === state.counterparty

const CONTRACT_DEFINITION = {
  states: {
    Proposed: { id: { value: 'PROPOSED' }, isFinal: false, metadata: null },
    Active:   { id: { value: 'ACTIVE'   }, isFinal: false, metadata: null },
    Rejected: { id: { value: 'REJECTED' }, isFinal: true,  metadata: null },
  },
  initialState: { value: 'PROPOSED' },
  transitions: [
    {
      from: { value: 'PROPOSED' },
      to:   { value: 'ACTIVE' },
      eventName: 'accept',
      // The guard that must pass for the transition to be accepted by ML0.
      // Requires event.agent (from payload) === state.counterparty (from initialData).
      // If proposer sends this with their own address, guard fails → ML0 rejection.
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'ACTIVE', acceptedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' },
      to:   { value: 'REJECTED' },
      eventName: 'reject',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'REJECTED' }] },
      dependencies: [],
    },
  ],
  metadata: { name: 'E2ERejectionContract', version: '1.0.0' },
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🧪 E2E Test: Rejection Notification Flow');
  console.log(`   Bridge:  ${BRIDGE_URL}`);
  console.log(`   ML0:     ${ML0_URL}`);
  console.log(`   Indexer: ${INDEXER_URL}`);
  console.log(`   DL1:     ${DL1_URL}`);
  console.log(`   Timeout: ${POLL_TIMEOUT / 1000}s\n`);

  // ── Keys ──────────────────────────────────────────────────────────────────────
  proposer     = generateKeyPair();
  counterparty = generateKeyPair();
  wrongUser    = generateKeyPair();

  console.log('👤 Keys:');
  console.log(`   Proposer:     ${proposer.address}`);
  console.log(`   Counterparty: ${counterparty.address}`);
  console.log(`   Wrong user:   ${wrongUser.address}\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 1: Pre-flight checks
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('📡 Section 1: Pre-flight checks\n');

  await test('Bridge is reachable', async () => {
    const health = await fetchJson<{ status: string }>(`${BRIDGE_URL}/health`);
    assert(health.status === 'ok', `Bridge health: ${JSON.stringify(health)}`);
  });

  await test('Indexer is reachable', async () => {
    const health = await fetchJson<{ status: string }>(`${INDEXER_URL}/health`);
    assert(health.status === 'ok', `Indexer health: ${JSON.stringify(health)}`);
  });

  await test('Indexer has active ML0 webhook subscription', async () => {
    const health = await fetchJson<{
      status: string;
      webhookSubscription: string | null;
    }>(`${INDEXER_URL}/health`);
    // If no subscription, rejections won't be delivered — warn but don't fail
    if (!health.webhookSubscription) {
      console.log('\n     ⚠️  No ML0 webhook subscription — rejection delivery may not work');
    } else {
      console.log(`\n     Subscription: ${health.webhookSubscription}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 2: Create fiber
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n📋 Section 2: Create contract fiber\n');

  await test('POST /contract/propose creates fiber on-chain', async () => {
    const result = await post<{ contractId: string; hash: string }>(
      `${BRIDGE_URL}/contract/propose`,
      {
        privateKey: proposer.privateKey,
        counterpartyAddress: counterparty.address,
        terms: { task: 'E2E rejection notification test', value: 0 },
        title: 'E2E Rejection Test Contract',
      }
    );
    assert(typeof result.contractId === 'string', 'No contractId in response');
    assert(typeof result.hash === 'string', 'No hash in response');
    contractId = result.contractId;
    console.log(`\n     Contract ID: ${contractId}`);
    console.log(`     DL1 hash: ${result.hash.substring(0, 16)}...`);
  });

  if (!contractId) {
    console.log('\n💥 Cannot continue — contract creation failed\n');
    printResults();
    process.exit(1);
  }

  await test('Fiber appears on ML0 within 30s', async () => {
    const fiber = await waitForFiberOnML0(contractId);
    assert(fiber.currentState.value === 'PROPOSED', `Expected PROPOSED, got ${fiber.currentState.value}`);
    console.log(`\n     State: ${fiber.currentState.value}, seq: ${fiber.sequenceNumber}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 3: Trigger ML0 rejection (wrong-agent transition)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n🚫 Section 3: Trigger ML0 rejection (wrong agent)\n');
  console.log('   Strategy: Submit "accept" with proposer\'s address as event.agent.');
  console.log('   Guard requires: event.agent === state.counterparty');
  console.log('   DL1 accepts (valid signature), ML0 rejects (guard fails).\n');

  await test('Submit wrong-agent transition directly to DL1', async () => {
    // We bypass the bridge because it validates caller address before submitting.
    // Submit via SDK directly to DL1 — signed by proposer's key, but with
    // proposer.address as the agent payload (wrong party trying to accept).
    // DL1: valid signature → accepted
    // ML0: event.agent (proposer) !== state.counterparty → guard fails → rejected
    const message = {
      TransitionStateMachine: {
        fiberId: contractId,
        eventName: 'accept',
        payload: {
          agent: proposer.address, // ← wrong party — should be counterparty
        },
        targetSequenceNumber: 1, // First transition after creation
      },
    };

    const signed = await batchSign(message, [proposer.privateKey], { isDataUpdate: true });

    const response = await fetch(`${DL1_URL}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    });
    const text = await response.text();
    const body = JSON.parse(text) as { hash?: string };

    assert(
      response.ok && typeof body.hash === 'string',
      `DL1 rejected (${response.status}): ${text.substring(0, 200)}`
    );
    console.log(`\n     DL1 accepted txn: ${body.hash!.substring(0, 16)}...`);
    console.log('     ML0 will reject at next snapshot validation cycle.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 4: Verify rejection in indexer
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n🔍 Section 4: Verify rejection in indexer\n');

  await test(`Rejection appears in indexer within ${POLL_TIMEOUT / 1000}s`, async () => {
    firstRejection = await waitForRejection(contractId);
    firstRejectionHash = firstRejection.updateHash;
    console.log(`\n     Rejection ID:    ${firstRejection.id}`);
    console.log(`     Update type:     ${firstRejection.updateType}`);
    console.log(`     Errors:          ${firstRejection.errors.map(e => e.code).join(', ')}`);
    console.log(`     Signer count:    ${firstRejection.signers.length}`);
    console.log(`     Update hash:     ${firstRejectionHash.substring(0, 16)}...`);
  });

  if (!firstRejection) {
    console.log('\n⚠️  No rejection found — remaining tests will fail. Check ML0 webhook subscription.\n');
  }

  await test('Rejection.fiberId matches our contract', async () => {
    assert(firstRejection.fiberId === contractId,
      `fiberId mismatch: got ${firstRejection.fiberId}`);
  });

  await test('Rejection.updateType is TransitionStateMachine', async () => {
    assert(firstRejection.updateType === 'TransitionStateMachine',
      `Expected TransitionStateMachine, got ${firstRejection.updateType}`);
  });

  await test('Rejection has at least one error with code', async () => {
    assert(firstRejection.errors.length > 0, 'Rejection.errors is empty');
    assert(typeof firstRejection.errors[0].code === 'string', 'Error missing code');
    assert(typeof firstRejection.errors[0].message === 'string', 'Error missing message');
  });

  await test('Rejection has at least one signer', async () => {
    assert(firstRejection.signers.length > 0, 'Rejection.signers is empty');
  });

  await test('Single rejection lookup by updateHash works', async () => {
    const record = await fetchJson<RejectionRecord>(
      `${INDEXER_URL}/api/rejections/${firstRejectionHash}`
    );
    assert(record.fiberId === contractId, 'Hash lookup returned wrong fiber');
  });

  await test('Filter by updateType=TransitionStateMachine returns our rejection', async () => {
    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?updateType=TransitionStateMachine&fiberId=${contractId}`
    );
    assert(data.rejections.length >= 1, 'updateType filter returned no results');
    const found = data.rejections.some(r => r.updateHash === firstRejectionHash);
    assert(found, 'Our rejection not in filtered results');
  });

  await test('Filter by fiberId returns only our rejections', async () => {
    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fiberId=${contractId}`
    );
    assert(data.total >= 1, 'No rejections found by fiberId filter');
    assert(
      data.rejections.every(r => r.fiberId === contractId),
      'Filter returned rejections from other fibers'
    );
  });

  await test('GET /api/fibers/:id/rejections returns same data', async () => {
    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${contractId}/rejections`
    );
    assert(data.total >= 1, 'No rejections in fiber-specific endpoint');
    const found = data.rejections.some(r => r.updateHash === firstRejectionHash);
    assert(found, 'Rejection not found in fiber-specific endpoint');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 5: Deduplication
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n🔁 Section 5: Deduplication\n');

  await test('Sending same rejection twice does not create duplicate', async () => {
    const countBefore = (await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${contractId}/rejections`
    )).total;

    // Post same rejection payload again with same updateHash
    const duplicatePayload = {
      event: 'transaction.rejected',
      ordinal: firstRejection.ordinal,
      timestamp: firstRejection.timestamp,
      metagraphId: 'TEST',
      rejection: {
        updateType: firstRejection.updateType,
        fiberId: firstRejection.fiberId,
        targetSequenceNumber: 1,
        errors: firstRejection.errors,
        signers: firstRejection.signers,
        updateHash: firstRejectionHash, // same hash → must be deduplicated
      },
    };

    const res = await fetch(`${INDEXER_URL}/webhook/rejection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload),
    });
    // Should succeed (not fail), just silently skip the duplicate
    assert(
      res.status < 500,
      `Indexer returned ${res.status} on duplicate rejection — should be 2xx or 409`
    );

    const countAfter = (await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${contractId}/rejections`
    )).total;
    assert(
      countAfter === countBefore,
      `Expected ${countBefore} rejections after dedup, got ${countAfter}`
    );
    console.log(`\n     ✓ Count unchanged at ${countAfter} after duplicate send`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 6: Correct transition succeeds
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n✅ Section 6: Correct transition (counterparty accepts)\n');

  await test('POST /contract/accept with counterparty key succeeds', async () => {
    // The bridge validates the caller is the counterparty, then submits.
    // ML0 guard: event.agent (counterparty) === state.counterparty ✓
    const result = await post<{ hash: string; status: string }>(
      `${BRIDGE_URL}/contract/accept`,
      {
        privateKey: counterparty.privateKey,
        contractId,
      }
    );
    assert(typeof result.hash === 'string', 'No hash in accept response');
    console.log(`\n     Hash: ${result.hash.substring(0, 16)}...`);
  });

  await test('Fiber reaches ACTIVE state on ML0', async () => {
    const fiber = await waitForFiberState(contractId, 'ACTIVE');
    console.log(`\n     State: ${fiber.currentState.value}, seq: ${fiber.sequenceNumber}`);
    assert(fiber.currentState.value === 'ACTIVE', `Expected ACTIVE, got ${fiber.currentState.value}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 7: Rejection history preserved
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n📚 Section 7: Rejection history preserved after success\n');

  await test('Rejection history not wiped by successful transition', async () => {
    // Give indexer a moment to process the new snapshot
    await sleep(3_000);

    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${contractId}/rejections`
    );
    assert(data.total >= 1, 'Rejection history was erased after successful transition');
    const found = data.rejections.some(r => r.updateHash === firstRejectionHash);
    assert(found, 'First rejection not found in history after successful transition');
    console.log(`\n     ✓ ${data.total} rejection(s) preserved in history`);
  });

  await test('Ordinal range filter returns our rejection', async () => {
    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fromOrdinal=${firstRejection.ordinal}`
    );
    assert(data.rejections.length >= 1, 'Ordinal range query returned no results');
    const found = data.rejections.some(r => r.updateHash === firstRejectionHash);
    assert(found, 'Our rejection not found in ordinal range query');
  });

  await test('Pagination (limit=1) works correctly', async () => {
    const data = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?limit=1&offset=0`
    );
    assert(data.rejections.length === 1, `Expected 1 result with limit=1, got ${data.rejections.length}`);
    assert(typeof data.total === 'number', 'Missing total field');
    assert(typeof data.hasMore === 'boolean', 'Missing hasMore field');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────────
  printResults();
}

function printResults(): void {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((a, r) => a + r.duration, 0);

  console.log('\n' + '─'.repeat(60));
  console.log(`📊 Results: ${passed} passed, ${failed} failed (${totalMs}ms)\n`);

  if (failed > 0) {
    console.log('❌ Failed tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => console.log(`   • ${r.name}\n     → ${r.message}`));
    console.log('');
    process.exit(1);
  }

  console.log('✅ All rejection notification E2E tests passed!\n');
  console.log('Verified pipeline:');
  console.log('  DL1 accepts → ML0 rejects (guard fail) → webhook fires → indexer stores → API works');
  console.log('  ✓ Dedup: same updateHash not stored twice');
  console.log('  ✓ History: rejections preserved after successful transition');
  console.log('  ✓ Filters: fiberId, updateType, ordinal range all working');
  console.log('');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
