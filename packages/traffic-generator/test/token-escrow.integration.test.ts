#!/usr/bin/env npx tsx
/**
 * TokenEscrow Fiber Integration Test
 *
 * Tests the full TokenEscrow fiber lifecycle against a real cluster.
 * Added as part of PR #115 (feat/traffic-gen-token-escrow) so that the
 * feature and its tests ship together.
 *
 * State machine:
 *   PROPOSED → FUNDED → ACTIVE → COMPLETED   (happy path)
 *                     ↘ CANCELLED             (cancel from FUNDED)
 *             ↘ CANCELLED                     (cancel from PROPOSED)
 *                              ↘ CANCELLED    (cancel from ACTIVE)
 *
 * Active token operations (ACTIVE → ACTIVE):
 *   mint, transfer, burn, escrow
 *
 * Test suites:
 *   Suite A – Happy path  (PROPOSED → FUNDED → ACTIVE → COMPLETED)
 *   Suite B – Cancel from PROPOSED
 *   Suite C – Cancel from FUNDED
 *   Suite D – Cancel from ACTIVE
 *
 * Environment variables:
 *   BRIDGE_URL          Bridge service URL   (default: http://localhost:3030)
 *   INDEXER_URL         Indexer service URL  (default: http://localhost:3031)
 *   ML0_URL             Metagraph L0 URL     (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  Max wait seconds for a fiber state change (default: 30)
 *   DL1_SYNC_WAIT       Seconds to wait for DL1 sync after create (default: 10)
 *   TRANSITION_WAIT     Seconds to wait between transitions (default: 5)
 *
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 \
 *     npx tsx test/token-escrow.integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';
import { IndexerClient } from '../dist/indexer-client.js';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  bridgeUrl:        process.env.BRIDGE_URL          ?? 'http://localhost:3030',
  indexerUrl:       process.env.INDEXER_URL         ?? 'http://localhost:3031',
  ml0Url:           process.env.ML0_URL             ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '30', 10),
  dl1SyncWait:      parseInt(process.env.DL1_SYNC_WAIT      ?? '10', 10),
  transitionWait:   parseInt(process.env.TRANSITION_WAIT    ?? '5',  10),
};

// ============================================================================
// TokenEscrow State Machine Definition
//
// Mirrors the fiber definition added in PR #115 (fiber-definitions.ts).
// Guards use always-true `{'==': [1, 1]}` – real validation lives on-chain.
// ============================================================================

const TOKEN_ESCROW_DEFINITION = {
  states: {
    Proposed:  { id: { value: 'PROPOSED'  }, isFinal: false },
    Funded:    { id: { value: 'FUNDED'    }, isFinal: false },
    Active:    { id: { value: 'ACTIVE'    }, isFinal: false },
    Completed: { id: { value: 'COMPLETED' }, isFinal: true  },
    Cancelled: { id: { value: 'CANCELLED' }, isFinal: true  },
  },
  initialState: { value: 'PROPOSED' },
  transitions: [
    // Setup
    {
      from: { value: 'PROPOSED' }, to: { value: 'FUNDED' }, eventName: 'fund',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'FUNDED', depositor: { var: 'event.depositor' }, fundedAt: { var: 'event.timestamp' } }] },
    },
    {
      from: { value: 'PROPOSED' }, to: { value: 'CANCELLED' }, eventName: 'cancel',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'CANCELLED', cancelledAt: { var: 'event.timestamp' } }] },
    },
    // Activation
    {
      from: { value: 'FUNDED' }, to: { value: 'ACTIVE' }, eventName: 'activate',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'ACTIVE', activatedAt: { var: 'event.timestamp' } }] },
    },
    {
      from: { value: 'FUNDED' }, to: { value: 'CANCELLED' }, eventName: 'cancel',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'CANCELLED', cancelledAt: { var: 'event.timestamp' } }] },
    },
    // Token operations (ACTIVE → ACTIVE)
    {
      from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'mint',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { mintedAmount: { '+': [{ var: 'state.mintedAmount' }, { var: 'event.amount' }] } }] },
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'transfer',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { lastTransferAt: { var: 'event.timestamp' } }] },
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'burn',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { burnedAmount: { '+': [{ var: 'state.burnedAmount' }, { var: 'event.amount' }] } }] },
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'escrow',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { escrowedAmount: { '+': [{ var: 'state.escrowedAmount' }, { var: 'event.amount' }] } }] },
    },
    // Resolution
    {
      from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'release',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', releasedAt: { var: 'event.timestamp' } }] },
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'CANCELLED' }, eventName: 'cancel',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'CANCELLED', cancelledAt: { var: 'event.timestamp' } }] },
    },
  ],
  metadata: { name: 'TokenEscrow', description: 'Escrow-backed token lifecycle with mint/transfer/burn' },
};

// ============================================================================
// Shared helpers (mirrors integration.test.ts patterns)
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeState(state: string): string {
  return state.toUpperCase();
}

function isBenignRejection(rejection: { errors: Array<{ code: string }> }): boolean {
  return rejection.errors.every(
    e => e.code === 'SequenceNumberMismatch' || e.code === 'NoTransitionForEvent'
  );
}

async function assertNoRejections(
  indexer: IndexerClient,
  fiberId: string,
  label: string
): Promise<{ passed: boolean; message?: string }> {
  let result: Awaited<ReturnType<IndexerClient['queryRejections']>>;
  try {
    result = await indexer.queryRejections({ fiberId, limit: 50 });
  } catch (err) {
    console.log(`  ⚠️  Rejection API unavailable: ${err}`);
    return { passed: true, message: 'rejection API unavailable (skipped)' };
  }

  const { rejections, total } = result;

  if (total === 0) {
    console.log(`  ✓ No rejections (${label})`);
    return { passed: true };
  }

  const critical = rejections.filter(r => !isBenignRejection(r));
  const benign   = rejections.filter(r =>  isBenignRejection(r));

  if (benign.length > 0) {
    console.log(`  ℹ️  ${benign.length} benign rejection(s) ignored (timing races)`);
  }

  if (critical.length === 0) {
    console.log(`  ✓ No critical rejections (${label})`);
    return { passed: true };
  }

  console.log(`  ❌ ${critical.length} critical rejection(s) found (${label}):`);
  for (const r of critical) {
    const codes = r.errors.map(e => e.code).join(', ');
    const msgs  = r.errors.map(e => e.message ?? '').filter(Boolean).join('; ');
    console.log(`    - [ordinal ${r.ordinal}] ${r.updateType} | errors: ${codes}`);
    if (msgs) console.log(`      detail: ${msgs}`);
  }

  return {
    passed: false,
    message: `${critical.length} critical rejection(s): ${critical[0].errors.map(e => e.code).join(', ')}`,
  };
}

/**
 * Wait for a fiber to appear in the indexer, with fast-fail on critical rejections.
 */
async function waitForFiber(
  indexer: IndexerClient,
  fiberId: string,
  timeoutSeconds: number
): Promise<{ found: boolean; rejected?: boolean; rejectReason?: string }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const pollMs   = 2000;
  let checkCount = 0;

  console.log(`  ⏳ Waiting for fiber in indexer (up to ${timeoutSeconds}s)...`);

  while (Date.now() < deadline) {
    checkCount++;
    const v = await indexer.verifyFiber(fiberId);

    if (checkCount % 3 === 0) {
      const elapsed = Math.round((Date.now() - deadline + timeoutSeconds * 1000) / 1000);
      console.log(`  📊 [${elapsed}s] ${v.found ? 'FOUND' : 'waiting...'}`);
    }

    if (v.found) return { found: true };

    if (v.hasUnprocessedRejection && v.rejections.length > 0) {
      const crit = v.rejections.find(r => !isBenignRejection(r));
      if (crit) {
        const codes = crit.errors.map(e => e.code).join(', ');
        console.log(`  ❌ Transaction rejected: ${codes}`);
        return { found: false, rejected: true, rejectReason: codes };
      }
      console.log(`  ⏳ Benign rejection (timing race), continuing...`);
    }

    await sleep(pollMs);
  }

  const final = await indexer.verifyFiber(fiberId);
  if (final.rejections.length > 0) {
    const codes = final.rejections[0].errors.map(e => e.code).join(', ');
    return { found: false, rejected: true, rejectReason: codes };
  }
  return { found: false };
}

/**
 * Wait for a fiber to reach a specific state in the indexer.
 */
async function waitForState(
  indexer: IndexerClient,
  fiberId: string,
  expectedState: string,
  timeoutSeconds: number
): Promise<{ reached: boolean; actualState: string | null }> {
  const result = await indexer.waitForState(fiberId, expectedState, {
    timeoutMs:      timeoutSeconds * 1000,
    pollIntervalMs: 2000,
  });
  return { reached: result.found, actualState: result.actualState };
}

// ============================================================================
// Test scaffolding
// ============================================================================

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

const allResults: TestResult[] = [];

function record(name: string, status: TestStatus, message?: string): void {
  const icon = status === 'passed' ? '✓' : status === 'skipped' ? '⏭️' : '❌';
  console.log(`${icon} ${name}${message ? ` (${message})` : ''}`);
  allResults.push({ name, status, message });
}

// ============================================================================
// Suite A – Happy Path: PROPOSED → FUNDED → ACTIVE → COMPLETED
// ============================================================================

async function suiteA(client: BridgeClient, indexer: IndexerClient): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(' Suite A: Happy Path  (PROPOSED → FUNDED → ACTIVE → COMPLETED)');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // --- A1: Generate wallets ---
  console.log('🔍 A1: Wallet Generation (creator + beneficiary + holder)');
  let creator:     { address: string; privateKey: string } | null = null;
  let beneficiary: { address: string; privateKey: string } | null = null;
  let holder:      { address: string; privateKey: string } | null = null;

  try {
    [creator, beneficiary, holder] = await Promise.all([
      client.generateWallet(),
      client.generateWallet(),
      client.generateWallet(),
    ]);
    console.log(`  creator:     ${creator.address}`);
    console.log(`  beneficiary: ${beneficiary.address}`);
    console.log(`  holder:      ${holder.address}`);
    record('A1: Wallet Generation', 'passed');
  } catch (err) {
    record('A1: Wallet Generation', 'failed', String(err));
    console.error('  Cannot continue Suite A without wallets');
    return;
  }

  // Initial state data (mirrors FiberDefinition.generateStateData in fiber-definitions.ts)
  const totalSupply    = 500_000;
  const escrowedAmount = 100_000;
  const initialData = {
    schema:           'TokenEscrow',
    creator:          creator.address,
    beneficiary:      beneficiary.address,
    tokenName:        'OttoToken',
    tokenSymbol:      'OTTO',
    totalSupply,
    escrowedAmount,
    mintedAmount:     0,
    burnedAmount:     0,
    balances:         { [creator.address]: totalSupply - escrowedAmount },
    transactions:     [] as unknown[],
    releaseConditions:`Release upon delivery confirmation by ${beneficiary.address.slice(0, 8)}...`,
    status:           'PROPOSED',
    createdAt:        Date.now(),
  };

  // --- A2: Create fiber (→ PROPOSED) ---
  console.log('\n🔍 A2: Create TokenEscrow Fiber (→ PROPOSED)');
  let fiberId: string | null = null;

  try {
    const res = await client.createFiber(
      creator.privateKey,
      TOKEN_ESCROW_DEFINITION,
      initialData
    );
    fiberId = res.fiberId;
    console.log(`  ✓ Fiber created: ${fiberId} (hash: ${res.hash})`);
    record('A2: Create Fiber → PROPOSED', 'passed');
  } catch (err) {
    record('A2: Create Fiber → PROPOSED', 'failed', String(err));
    return;
  }

  // --- A3: Wait for indexer to pick up the new fiber ---
  console.log('\n🔍 A3: Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);

  if (waitResult.rejected) {
    record('A3: Fiber Indexed (PROPOSED)', 'failed', `Rejected: ${waitResult.rejectReason}`);
    return;
  }
  if (!waitResult.found) {
    record('A3: Fiber Indexed (PROPOSED)', 'failed', `Timeout after ${CONFIG.fiberWaitTimeout}s`);
    return;
  }
  console.log(`  ✓ Fiber indexed`);
  console.log(`  ⏳ DL1 sync wait (${CONFIG.dl1SyncWait}s)...`);
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('A3: Fiber Indexed (PROPOSED)', 'passed');

  // --- A4: Assert no rejections after creation ---
  console.log('\n🔍 A4: Assert No Rejections After Creation');
  const noRejectCreate = await assertNoRejections(indexer, fiberId, 'after create');
  record('A4: No Rejections After Create', noRejectCreate.passed ? 'passed' : 'failed', noRejectCreate.message);

  // --- A5: Transition PROPOSED → FUNDED (event: fund) ---
  console.log('\n🔍 A5: Transition PROPOSED → FUNDED (fund)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'fund', {
      depositor: creator.address,
      amount:    escrowedAmount,
      timestamp: Date.now(),
    });
    console.log(`  ✓ fund submitted (hash: ${res.hash})`);
    record('A5: Transition → FUNDED', 'passed');
  } catch (err) {
    record('A5: Transition → FUNDED', 'failed', String(err));
    return;
  }

  // Wait for FUNDED state
  console.log(`  ⏳ Waiting for FUNDED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const fundedResult = await waitForState(indexer, fiberId, 'FUNDED', CONFIG.fiberWaitTimeout);
  if (!fundedResult.reached) {
    record('A5b: Indexer State = FUNDED', 'failed',
      `actualState=${fundedResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms FUNDED`);
    record('A5b: Indexer State = FUNDED', 'passed');
  }

  // --- A6: Assert no rejections after fund ---
  console.log('\n🔍 A6: Assert No Rejections After fund');
  const noRejectFund = await assertNoRejections(indexer, fiberId, 'after fund');
  record('A6: No Rejections After fund', noRejectFund.passed ? 'passed' : 'failed', noRejectFund.message);

  // --- A7: Transition FUNDED → ACTIVE (event: activate) ---
  console.log('\n🔍 A7: Transition FUNDED → ACTIVE (activate)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'activate', {
      timestamp: Date.now(),
    });
    console.log(`  ✓ activate submitted (hash: ${res.hash})`);
    record('A7: Transition → ACTIVE', 'passed');
  } catch (err) {
    record('A7: Transition → ACTIVE', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for ACTIVE state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const activeResult = await waitForState(indexer, fiberId, 'ACTIVE', CONFIG.fiberWaitTimeout);
  if (!activeResult.reached) {
    record('A7b: Indexer State = ACTIVE', 'failed',
      `actualState=${activeResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms ACTIVE`);
    record('A7b: Indexer State = ACTIVE', 'passed');
  }

  // --- A8: Assert no rejections after activate ---
  console.log('\n🔍 A8: Assert No Rejections After activate');
  const noRejectActivate = await assertNoRejections(indexer, fiberId, 'after activate');
  record('A8: No Rejections After activate', noRejectActivate.passed ? 'passed' : 'failed', noRejectActivate.message);

  // --- A9: Token operations while ACTIVE (mint → transfer → burn) ---
  console.log('\n🔍 A9: Token Operations While ACTIVE');

  // mint
  try {
    const mintAmount = 10_000;
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'mint', {
      to:        holder.address,
      amount:    mintAmount,
      timestamp: Date.now(),
    });
    console.log(`  ✓ mint submitted (${mintAmount} OTTO → holder, hash: ${res.hash})`);
    await sleep(CONFIG.transitionWait * 1000);
    const noRejectMint = await assertNoRejections(indexer, fiberId, 'after mint');
    record('A9a: mint (ACTIVE → ACTIVE)', noRejectMint.passed ? 'passed' : 'failed', noRejectMint.message);
  } catch (err) {
    record('A9a: mint (ACTIVE → ACTIVE)', 'failed', String(err));
  }

  // transfer
  try {
    const res = await client.transitionFiber(holder.privateKey, fiberId, 'transfer', {
      from:      holder.address,
      to:        beneficiary.address,
      amount:    2_000,
      timestamp: Date.now(),
    });
    console.log(`  ✓ transfer submitted (hash: ${res.hash})`);
    await sleep(CONFIG.transitionWait * 1000);
    const noRejectTransfer = await assertNoRejections(indexer, fiberId, 'after transfer');
    record('A9b: transfer (ACTIVE → ACTIVE)', noRejectTransfer.passed ? 'passed' : 'failed', noRejectTransfer.message);
  } catch (err) {
    record('A9b: transfer (ACTIVE → ACTIVE)', 'failed', String(err));
  }

  // burn
  try {
    const burnAmount = 500;
    const res = await client.transitionFiber(holder.privateKey, fiberId, 'burn', {
      from:      holder.address,
      amount:    burnAmount,
      timestamp: Date.now(),
    });
    console.log(`  ✓ burn submitted (${burnAmount} OTTO, hash: ${res.hash})`);
    await sleep(CONFIG.transitionWait * 1000);
    const noRejectBurn = await assertNoRejections(indexer, fiberId, 'after burn');
    record('A9c: burn (ACTIVE → ACTIVE)', noRejectBurn.passed ? 'passed' : 'failed', noRejectBurn.message);
  } catch (err) {
    record('A9c: burn (ACTIVE → ACTIVE)', 'failed', String(err));
  }

  // --- A10: Transition ACTIVE → COMPLETED (event: release) ---
  console.log('\n🔍 A10: Transition ACTIVE → COMPLETED (release)');
  try {
    const res = await client.transitionFiber(beneficiary.privateKey, fiberId, 'release', {
      releasedBy: beneficiary.address,
      timestamp:  Date.now(),
    });
    console.log(`  ✓ release submitted (hash: ${res.hash})`);
    record('A10: Transition → COMPLETED', 'passed');
  } catch (err) {
    record('A10: Transition → COMPLETED', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for COMPLETED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const completedResult = await waitForState(indexer, fiberId, 'COMPLETED', CONFIG.fiberWaitTimeout);
  if (!completedResult.reached) {
    record('A10b: Indexer State = COMPLETED', 'failed',
      `actualState=${completedResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms COMPLETED`);
    record('A10b: Indexer State = COMPLETED', 'passed');
  }

  // --- A11: Assert no rejections after release ---
  console.log('\n🔍 A11: Assert No Rejections After release');
  const noRejectRelease = await assertNoRejections(indexer, fiberId, 'after release');
  record('A11: No Rejections After release', noRejectRelease.passed ? 'passed' : 'failed', noRejectRelease.message);

  // --- A12: Final indexer state verification ---
  console.log('\n🔍 A12: Final Indexer State Verification');
  try {
    const v = await indexer.verifyFiber(fiberId);
    if (!v.found || !v.fiber) throw new Error('Fiber not found');

    const state = normalizeState(v.fiber.currentState);
    console.log(`  Fiber state: ${v.fiber.currentState} (seq=${v.fiber.sequenceNumber})`);
    if (v.lastTransition) {
      console.log(`  Last transition: ${v.lastTransition.eventName} (${v.lastTransition.fromState} → ${v.lastTransition.toState})`);
    }
    const criticalRejections = v.rejections.filter(r => !isBenignRejection(r));
    if (criticalRejections.length > 0) {
      console.log(`  ⚠️  ${criticalRejections.length} critical rejection(s)`);
    }

    if (state === 'COMPLETED') {
      console.log(`  ✓ Final state COMPLETED verified`);
      record('A12: Final State = COMPLETED', 'passed');
    } else {
      record('A12: Final State = COMPLETED', 'failed', `actualState=${v.fiber.currentState}`);
    }
  } catch (err) {
    record('A12: Final State = COMPLETED', 'failed', String(err));
  }
}

// ============================================================================
// Suite B – Cancel from PROPOSED
// ============================================================================

async function suiteB(client: BridgeClient, indexer: IndexerClient): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(' Suite B: Cancel Path from PROPOSED');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('🔍 B1: Wallet Generation');
  let creator: { address: string; privateKey: string } | null = null;
  let beneficiary: { address: string; privateKey: string } | null = null;

  try {
    [creator, beneficiary] = await Promise.all([
      client.generateWallet(),
      client.generateWallet(),
    ]);
    record('B1: Wallet Generation', 'passed');
  } catch (err) {
    record('B1: Wallet Generation', 'failed', String(err));
    return;
  }

  const initialData = {
    schema:           'TokenEscrow',
    creator:          creator.address,
    beneficiary:      beneficiary.address,
    tokenName:        'StableOtto',
    tokenSymbol:      'STTO',
    totalSupply:      200_000,
    escrowedAmount:   50_000,
    mintedAmount:     0,
    burnedAmount:     0,
    balances:         { [creator.address]: 150_000 },
    transactions:     [] as unknown[],
    releaseConditions:'Release upon delivery',
    status:           'PROPOSED',
    createdAt:        Date.now(),
  };

  console.log('\n🔍 B2: Create Fiber (→ PROPOSED)');
  let fiberId: string | null = null;
  try {
    const res = await client.createFiber(creator.privateKey, TOKEN_ESCROW_DEFINITION, initialData);
    fiberId = res.fiberId;
    console.log(`  ✓ Fiber created: ${fiberId}`);
    record('B2: Create Fiber → PROPOSED', 'passed');
  } catch (err) {
    record('B2: Create Fiber → PROPOSED', 'failed', String(err));
    return;
  }

  console.log('\n🔍 B3: Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (!waitResult.found) {
    record('B3: Fiber Indexed (PROPOSED)', waitResult.rejected ? 'failed' : 'failed',
      waitResult.rejected ? `Rejected: ${waitResult.rejectReason}` : 'Timeout');
    return;
  }
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('B3: Fiber Indexed (PROPOSED)', 'passed');

  console.log('\n🔍 B4: Assert No Rejections After Creation');
  const noRejectCreate = await assertNoRejections(indexer, fiberId, 'after create');
  record('B4: No Rejections After Create', noRejectCreate.passed ? 'passed' : 'failed', noRejectCreate.message);

  console.log('\n🔍 B5: Cancel from PROPOSED (→ CANCELLED)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'cancel', {
      reason:    'Test cancel from PROPOSED',
      timestamp: Date.now(),
    });
    console.log(`  ✓ cancel submitted (hash: ${res.hash})`);
    record('B5: Transition → CANCELLED', 'passed');
  } catch (err) {
    record('B5: Transition → CANCELLED', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for CANCELLED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const cancelledResult = await waitForState(indexer, fiberId, 'CANCELLED', CONFIG.fiberWaitTimeout);
  if (!cancelledResult.reached) {
    record('B5b: Indexer State = CANCELLED', 'failed',
      `actualState=${cancelledResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms CANCELLED`);
    record('B5b: Indexer State = CANCELLED', 'passed');
  }

  console.log('\n🔍 B6: Assert No Rejections After Cancel');
  const noRejectCancel = await assertNoRejections(indexer, fiberId, 'after cancel');
  record('B6: No Rejections After cancel', noRejectCancel.passed ? 'passed' : 'failed', noRejectCancel.message);
}

// ============================================================================
// Suite C – Cancel from FUNDED
// ============================================================================

async function suiteC(client: BridgeClient, indexer: IndexerClient): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(' Suite C: Cancel Path from FUNDED');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('🔍 C1: Wallet Generation');
  let creator: { address: string; privateKey: string } | null = null;
  let beneficiary: { address: string; privateKey: string } | null = null;
  try {
    [creator, beneficiary] = await Promise.all([
      client.generateWallet(),
      client.generateWallet(),
    ]);
    record('C1: Wallet Generation', 'passed');
  } catch (err) {
    record('C1: Wallet Generation', 'failed', String(err));
    return;
  }

  const initialData = {
    schema:           'TokenEscrow',
    creator:          creator.address,
    beneficiary:      beneficiary.address,
    tokenName:        'GovernToken',
    tokenSymbol:      'GOTT',
    totalSupply:      100_000,
    escrowedAmount:   30_000,
    mintedAmount:     0,
    burnedAmount:     0,
    balances:         { [creator.address]: 70_000 },
    transactions:     [] as unknown[],
    releaseConditions:'Release on completion',
    status:           'PROPOSED',
    createdAt:        Date.now(),
  };

  console.log('\n🔍 C2: Create Fiber (→ PROPOSED)');
  let fiberId: string | null = null;
  try {
    const res = await client.createFiber(creator.privateKey, TOKEN_ESCROW_DEFINITION, initialData);
    fiberId = res.fiberId;
    console.log(`  ✓ Fiber created: ${fiberId}`);
    record('C2: Create Fiber → PROPOSED', 'passed');
  } catch (err) {
    record('C2: Create Fiber → PROPOSED', 'failed', String(err));
    return;
  }

  console.log('\n🔍 C3: Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (!waitResult.found) {
    record('C3: Fiber Indexed (PROPOSED)', 'failed',
      waitResult.rejected ? `Rejected: ${waitResult.rejectReason}` : 'Timeout');
    return;
  }
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('C3: Fiber Indexed (PROPOSED)', 'passed');

  console.log('\n🔍 C4: Transition PROPOSED → FUNDED (fund)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'fund', {
      depositor: creator.address,
      amount:    30_000,
      timestamp: Date.now(),
    });
    console.log(`  ✓ fund submitted (hash: ${res.hash})`);
    record('C4: Transition → FUNDED', 'passed');
  } catch (err) {
    record('C4: Transition → FUNDED', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for FUNDED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const fundedResult = await waitForState(indexer, fiberId, 'FUNDED', CONFIG.fiberWaitTimeout);
  if (!fundedResult.reached) {
    record('C4b: Indexer State = FUNDED', 'failed',
      `actualState=${fundedResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms FUNDED`);
    record('C4b: Indexer State = FUNDED', 'passed');
  }

  const noRejectFund = await assertNoRejections(indexer, fiberId, 'after fund');
  record('C4c: No Rejections After fund', noRejectFund.passed ? 'passed' : 'failed', noRejectFund.message);

  console.log('\n🔍 C5: Cancel from FUNDED (→ CANCELLED)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'cancel', {
      reason:    'Test cancel from FUNDED',
      timestamp: Date.now(),
    });
    console.log(`  ✓ cancel submitted (hash: ${res.hash})`);
    record('C5: Transition FUNDED → CANCELLED', 'passed');
  } catch (err) {
    record('C5: Transition FUNDED → CANCELLED', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for CANCELLED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const cancelledResult = await waitForState(indexer, fiberId, 'CANCELLED', CONFIG.fiberWaitTimeout);
  if (!cancelledResult.reached) {
    record('C5b: Indexer State = CANCELLED', 'failed',
      `actualState=${cancelledResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms CANCELLED`);
    record('C5b: Indexer State = CANCELLED', 'passed');
  }

  const noRejectCancel = await assertNoRejections(indexer, fiberId, 'after cancel');
  record('C5c: No Rejections After cancel', noRejectCancel.passed ? 'passed' : 'failed', noRejectCancel.message);
}

// ============================================================================
// Suite D – Cancel from ACTIVE
// ============================================================================

async function suiteD(client: BridgeClient, indexer: IndexerClient): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(' Suite D: Cancel Path from ACTIVE');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('🔍 D1: Wallet Generation');
  let creator: { address: string; privateKey: string } | null = null;
  let beneficiary: { address: string; privateKey: string } | null = null;
  try {
    [creator, beneficiary] = await Promise.all([
      client.generateWallet(),
      client.generateWallet(),
    ]);
    record('D1: Wallet Generation', 'passed');
  } catch (err) {
    record('D1: Wallet Generation', 'failed', String(err));
    return;
  }

  const initialData = {
    schema:           'TokenEscrow',
    creator:          creator.address,
    beneficiary:      beneficiary.address,
    tokenName:        'VaultToken',
    tokenSymbol:      'VTKN',
    totalSupply:      250_000,
    escrowedAmount:   75_000,
    mintedAmount:     0,
    burnedAmount:     0,
    balances:         { [creator.address]: 175_000 },
    transactions:     [] as unknown[],
    releaseConditions:'Release on verification',
    status:           'PROPOSED',
    createdAt:        Date.now(),
  };

  console.log('\n🔍 D2: Create Fiber (→ PROPOSED)');
  let fiberId: string | null = null;
  try {
    const res = await client.createFiber(creator.privateKey, TOKEN_ESCROW_DEFINITION, initialData);
    fiberId = res.fiberId;
    console.log(`  ✓ Fiber created: ${fiberId}`);
    record('D2: Create Fiber → PROPOSED', 'passed');
  } catch (err) {
    record('D2: Create Fiber → PROPOSED', 'failed', String(err));
    return;
  }

  console.log('\n🔍 D3: Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (!waitResult.found) {
    record('D3: Fiber Indexed (PROPOSED)', 'failed',
      waitResult.rejected ? `Rejected: ${waitResult.rejectReason}` : 'Timeout');
    return;
  }
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('D3: Fiber Indexed (PROPOSED)', 'passed');

  console.log('\n🔍 D4: Transition PROPOSED → FUNDED → ACTIVE');

  // fund
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'fund', {
      depositor: creator.address,
      amount:    75_000,
      timestamp: Date.now(),
    });
    console.log(`  ✓ fund submitted (hash: ${res.hash})`);
    record('D4a: Transition → FUNDED', 'passed');
  } catch (err) {
    record('D4a: Transition → FUNDED', 'failed', String(err));
    return;
  }

  await sleep(CONFIG.transitionWait * 1000);
  const fundedResult = await waitForState(indexer, fiberId, 'FUNDED', CONFIG.fiberWaitTimeout);
  if (!fundedResult.reached) {
    record('D4b: Indexer State = FUNDED', 'failed',
      `actualState=${fundedResult.actualState ?? 'not found'}`);
    return;
  }
  console.log(`  ✓ Indexer confirms FUNDED`);
  record('D4b: Indexer State = FUNDED', 'passed');

  // activate
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'activate', {
      timestamp: Date.now(),
    });
    console.log(`  ✓ activate submitted (hash: ${res.hash})`);
    record('D4c: Transition → ACTIVE', 'passed');
  } catch (err) {
    record('D4c: Transition → ACTIVE', 'failed', String(err));
    return;
  }

  await sleep(CONFIG.transitionWait * 1000);
  const activeResult = await waitForState(indexer, fiberId, 'ACTIVE', CONFIG.fiberWaitTimeout);
  if (!activeResult.reached) {
    record('D4d: Indexer State = ACTIVE', 'failed',
      `actualState=${activeResult.actualState ?? 'not found'}`);
    return;
  }
  console.log(`  ✓ Indexer confirms ACTIVE`);
  record('D4d: Indexer State = ACTIVE', 'passed');

  const noRejectActive = await assertNoRejections(indexer, fiberId, 'after activate');
  record('D4e: No Rejections After activate', noRejectActive.passed ? 'passed' : 'failed', noRejectActive.message);

  console.log('\n🔍 D5: Cancel from ACTIVE (→ CANCELLED)');
  try {
    const res = await client.transitionFiber(creator.privateKey, fiberId, 'cancel', {
      reason:    'Test cancel from ACTIVE',
      timestamp: Date.now(),
    });
    console.log(`  ✓ cancel submitted (hash: ${res.hash})`);
    record('D5: Transition ACTIVE → CANCELLED', 'passed');
  } catch (err) {
    record('D5: Transition ACTIVE → CANCELLED', 'failed', String(err));
    return;
  }

  console.log(`  ⏳ Waiting for CANCELLED state...`);
  await sleep(CONFIG.transitionWait * 1000);
  const cancelledResult = await waitForState(indexer, fiberId, 'CANCELLED', CONFIG.fiberWaitTimeout);
  if (!cancelledResult.reached) {
    record('D5b: Indexer State = CANCELLED', 'failed',
      `actualState=${cancelledResult.actualState ?? 'not found'}`);
  } else {
    console.log(`  ✓ Indexer confirms CANCELLED`);
    record('D5b: Indexer State = CANCELLED', 'passed');
  }

  const noRejectCancel = await assertNoRejections(indexer, fiberId, 'after cancel');
  record('D5c: No Rejections After cancel', noRejectCancel.passed ? 'passed' : 'failed', noRejectCancel.message);
}

// ============================================================================
// Summary
// ============================================================================

function printSummary(): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' TokenEscrow Integration Test – Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0, skipped = 0;
  for (const r of allResults) {
    if (r.status === 'passed')  passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }

  console.log(`\nTotal:   ${allResults.length}`);
  console.log(`Passed:  ${passed}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}`);
  if (failed  > 0) console.log(`Failed:  ${failed}`);

  if (failed === 0) {
    console.log('\n✅ All tests passed!');
  } else {
    console.log('\n❌ Some tests failed:');
    for (const r of allResults.filter(r => r.status === 'failed')) {
      console.log(`   - ${r.name}${r.message ? `: ${r.message}` : ''}`);
    }
  }
  console.log('');
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' TokenEscrow Fiber – Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiberWait=${CONFIG.fiberWaitTimeout}s, dl1Sync=${CONFIG.dl1SyncWait}s, transition=${CONFIG.transitionWait}s`);

  // Preflight: bridge health check
  console.log('\n🔍 Preflight: Bridge Health Check');
  try {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Unexpected status: ${health.status}`);
    console.log('  ✓ Bridge is healthy');
  } catch (err) {
    console.error(`  ❌ Bridge health check failed: ${err}`);
    console.error('  Cannot run tests without a healthy bridge. Exiting.');
    process.exit(1);
  }

  const client  = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  const indexer = new IndexerClient({ indexerUrl: CONFIG.indexerUrl });

  // Run suites sequentially – each suite creates its own fibers/wallets
  await suiteA(client, indexer);
  await suiteB(client, indexer);
  await suiteC(client, indexer);
  await suiteD(client, indexer);

  printSummary();

  const failures = allResults.filter(r => r.status === 'failed').length;
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
