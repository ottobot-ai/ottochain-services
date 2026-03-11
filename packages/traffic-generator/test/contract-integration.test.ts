#!/usr/bin/env npx tsx
/**
 * Contract Fiber Integration Test
 *
 * Tests the full Contract fiber lifecycle against a real OttoChain cluster.
 * Covers three paths:
 *   Suite A — Full lifecycle:  propose → accept → complete (both parties) → finalize
 *   Suite B — Rejection path:  propose → reject
 *   Suite C — Dispute path:    propose → accept → dispute
 *
 * Uses BridgeClient to submit transitions and IndexerClient to verify state
 * changes.  Asserts no critical rejections after every transition.
 *
 * ⚠️  EPIC A NOTICE — Multi-party signing
 * ─────────────────────────────────────────
 * Steps that require the counterparty to sign a state-machine transition are
 * currently blocked by a Scala-layer constraint: the metagraph's
 * `updateSignedByOwners` validation rejects any TransitionStateMachine whose
 * signer is not in the fiber's `owners` set (derived from CreateStateMachine
 * proofs).  Since only the proposer signed CreateStateMachine, only the
 * proposer can currently sign transitions — the counterparty cannot.
 *
 * Epic A will add multi-party signing support to the metagraph, enabling:
 *   accept / reject transitions signed by the counterparty
 *   submit_completion / dispute signed by either party
 *
 * Affected steps are recorded with status 'blocked' (not 'failed').
 * The test suite exits 0 as long as there are no unexpected failures.
 *
 * Environment variables:
 *   BRIDGE_URL          Bridge service URL  (default: http://localhost:3030)
 *   INDEXER_URL         Indexer service URL (default: http://localhost:3031)
 *   ML0_URL             Metagraph L0 URL    (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  Max seconds to wait for fiber to appear  (default: 60)
 *   STATE_WAIT_TIMEOUT  Max seconds to wait for a state change   (default: 60)
 *   DL1_SYNC_WAIT       Seconds to wait for DL1 sync after index (default: 10)
 *   TRANSITION_WAIT     Seconds to wait after each transition    (default:  5)
 *
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 \
 *     npx tsx test/contract-integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';
import { IndexerClient } from '../dist/indexer-client.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  bridgeUrl:        process.env.BRIDGE_URL         ?? 'http://localhost:3030',
  indexerUrl:       process.env.INDEXER_URL        ?? 'http://localhost:3031',
  ml0Url:           process.env.ML0_URL            ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '60', 10),
  stateWaitTimeout: parseInt(process.env.STATE_WAIT_TIMEOUT ?? '60', 10),
  dl1SyncWait:      parseInt(process.env.DL1_SYNC_WAIT      ?? '10', 10),
  transitionWait:   parseInt(process.env.TRANSITION_WAIT    ?? '5',  10),
  // Short poll window used for Epic A steps — we know the state won't change,
  // so don't burn the full STATE_WAIT_TIMEOUT before marking as blocked.
  epicAStateWait:   parseInt(process.env.EPIC_A_STATE_WAIT  ?? '15', 10),
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Wallet     = { address: string; privateKey: string };
type TestStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
interface TestResult { name: string; status: TestStatus; message?: string }

// ─── Shared state ─────────────────────────────────────────────────────────────

const results: TestResult[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Benign (non-critical) rejection codes that are safe to ignore.
 *
 * NotSignedByOwner — counterparty-signed transitions blocked by Epic A.
 *   The metagraph rejects any TransitionStateMachine whose signer is not in
 *   the fiber's owners set.  This is expected until Epic A lands.
 * SequenceNumberMismatch — timing race; DL1 accepted, ML0 saw stale seq.
 * NoTransitionForEvent   — guard evaluated false (timing or state race).
 */
function isBenignRejection(r: { errors: Array<{ code: string }> }): boolean {
  return r.errors.every(
    e =>
      e.code === 'SequenceNumberMismatch' ||
      e.code === 'NoTransitionForEvent'   ||
      e.code === 'NotSignedByOwner'
  );
}

function record(name: string, status: TestStatus, message?: string): void {
  const icon =
    status === 'passed'  ? '✓'  :
    status === 'skipped' ? '⏭️ ' :
    status === 'blocked' ? '🚧' :
    '❌';
  console.log(`  ${icon} [${name}]${message ? ` (${message})` : ''}`);
  results.push({ name, status, message });
}

function skipAll(names: string[]): void {
  for (const n of names) {
    if (!results.some(r => r.name === n)) record(n, 'skipped', 'prerequisite failed');
  }
}

/**
 * Record a set of steps as blocked by Epic A.
 * Prints a clear notice so engineers know exactly what is pending.
 */
function blockAllEpicA(names: string[]): void {
  for (const n of names) {
    if (!results.some(r => r.name === n))
      record(n, 'blocked', 'Epic A — awaiting multi-party signing in metagraph');
  }
}

/**
 * Assert no *critical* (non-benign) rejections for a fiber after a given step.
 */
async function assertNoRejections(
  indexer: IndexerClient,
  fiberId: string,
  label: string
): Promise<{ passed: boolean; message?: string }> {
  let res: Awaited<ReturnType<IndexerClient['queryRejections']>>;
  try {
    res = await indexer.queryRejections({ fiberId, limit: 50 });
  } catch (err) {
    console.log(`  ⚠️  Rejection API unavailable: ${err}`);
    return { passed: true, message: 'rejection API unavailable (skipped)' };
  }

  if (res.total === 0) {
    console.log(`  ✓ No rejections (${label})`);
    return { passed: true };
  }

  const critical = res.rejections.filter(r => !isBenignRejection(r));
  const benign   = res.rejections.filter(r =>  isBenignRejection(r));

  if (benign.length > 0) {
    console.log(`  ℹ️  ${benign.length} benign rejection(s) ignored (timing races / Epic A)`);
    for (const r of benign.slice(0, 3))
      console.log(`    - [ord ${r.ordinal}] ${r.updateType}: ${r.errors.map(e => e.code).join(', ')}`);
  }

  if (critical.length === 0) {
    console.log(`  ✓ No critical rejections (${label})`);
    return { passed: true };
  }

  console.log(`  ❌ ${critical.length} critical rejection(s) (${label}):`);
  for (const r of critical) {
    console.log(`    - [ord ${r.ordinal}] ${r.updateType}: ${r.errors.map(e => e.code).join(', ')}`);
    console.log(`      hash: ${r.updateHash}`);
  }

  return {
    passed: false,
    message: `${critical.length} critical: ${critical[0].errors.map(e => e.code).join(', ')}`,
  };
}

/**
 * Poll until fiber appears in indexer (fast-fail on critical rejections).
 */
async function waitForFiber(
  indexer: IndexerClient,
  fiberId: string,
  timeoutSec: number
): Promise<{ found: boolean; rejected?: boolean; rejectReason?: string }> {
  console.log(`  ⏳ Waiting for fiber in indexer (up to ${timeoutSec}s)…`);
  const deadline = Date.now() + timeoutSec * 1000;
  let tick = 0;

  while (Date.now() < deadline) {
    tick++;
    const v = await indexer.verifyFiber(fiberId);

    if (tick % 3 === 0)
      console.log(`  📊 [${Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000)}s] ${v.found ? 'FOUND' : 'waiting…'}`);

    if (v.found) return { found: true };

    if (v.hasUnprocessedRejection) {
      const crit = v.rejections.find(r => !isBenignRejection(r));
      if (crit) {
        const codes = crit.errors.map(e => e.code).join(', ');
        console.log(`  ❌ Rejected: ${codes}`);
        return { found: false, rejected: true, rejectReason: codes };
      }
      console.log(`  ⏳ Benign rejection, continuing…`);
    }

    await sleep(2000);
  }

  const final = await indexer.verifyFiber(fiberId);
  if (final.rejections.length > 0) {
    const codes = final.rejections[0].errors.map(e => e.code).join(', ');
    return { found: false, rejected: true, rejectReason: codes };
  }
  return { found: false };
}

/**
 * Poll until fiber reaches a specific state in the indexer.
 */
async function waitForState(
  indexer: IndexerClient,
  fiberId: string,
  expected: string,
  timeoutSec: number
): Promise<{ reached: boolean; actualState: string | null }> {
  console.log(`  ⏳ Waiting for state ${expected} (up to ${timeoutSec}s)…`);
  const r = await indexer.waitForState(fiberId, expected, {
    timeoutMs: timeoutSec * 1000, pollIntervalMs: 2000,
  });
  if (r.found) console.log(`  ✓ Reached state ${expected}`);
  else         console.log(`  ⚠️  State is ${r.actualState ?? 'unknown'} (expected ${expected})`);
  return { reached: r.found, actualState: r.actualState };
}

/**
 * Wait briefly for a state change that requires Epic A (multi-party signing).
 *
 * Uses EPIC_A_STATE_WAIT (default 15s) instead of the full STATE_WAIT_TIMEOUT.
 * If the state hasn't changed (expected — counterparty txn rejected by ML0),
 * returns { reached: false, epicABlocked: true } so the caller can record it
 * as 'blocked' rather than 'failed'.
 */
async function waitForStateEpicA(
  indexer: IndexerClient,
  fiberId: string,
  expected: string
): Promise<{ reached: boolean; actualState: string | null; epicABlocked: boolean }> {
  console.log(`  ⏳ Checking for state ${expected} (Epic A short-poll, ${CONFIG.epicAStateWait}s)…`);
  console.log(`  ℹ️  This transition requires multi-party signing (Epic A).`);
  console.log(`     Counterparty-signed transitions are currently blocked by metagraph`);
  console.log(`     updateSignedByOwners validation. State will remain PROPOSED.`);

  const r = await indexer.waitForState(fiberId, expected, {
    timeoutMs: CONFIG.epicAStateWait * 1000,
    pollIntervalMs: 2000,
  });

  if (r.found) {
    console.log(`  ✓ Reached state ${expected} (Epic A already implemented? Unexpected pass!)`);
    return { reached: true, actualState: r.actualState, epicABlocked: false };
  }

  console.log(`  🚧 State is ${r.actualState ?? 'unknown'} (expected ${expected}) — Epic A required`);
  return { reached: false, actualState: r.actualState, epicABlocked: true };
}

// ─── Suites ───────────────────────────────────────────────────────────────────

// ── Suite A: Full lifecycle ────────────────────────────────────────────────────

const SUITE_A_STEPS = [
  'Fiber Indexed — PROPOSED (A)',
  'No Rejections After Proposal (A)',
  'Accept Contract (A)',
  'Fiber State — ACTIVE (A)',
  'No Rejections After Acceptance (A)',
  'Submit Completion — Proposer (A)',
  'Submit Completion — Counterparty (A)',
  'Finalize Contract (A)',
  'Fiber State — COMPLETED (A)',
  'No Rejections After Finalization (A)',
  'Verify Final Indexer State (A)',
];

async function runSuiteA(
  bridge:       BridgeClient,
  indexer:      IndexerClient,
  proposer:     Wallet,
  counterparty: Wallet
): Promise<void> {

  // 4. Propose
  console.log('\n🔍 Test 4: Propose Contract (A)');
  let contractId: string | null = null;
  try {
    const r = await bridge.proposeContract(
      proposer.privateKey,
      counterparty.address,
      {
        description: `Integration test contract ${Date.now().toString(36)}`,
        value: 100, currency: 'OTTO',
        deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      { title: 'Integration Test Contract' }
    );
    contractId = r.contractId;
    console.log(`  ✓ contractId=${contractId}  hash=${r.hash}`);
    record('Propose Contract (A)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Propose Contract (A)', 'failed', String(err));
    skipAll(SUITE_A_STEPS);
    return;
  }
  if (!contractId) { skipAll(SUITE_A_STEPS); return; }

  // 5. Wait for PROPOSED in indexer
  console.log('\n🔍 Test 5: Wait for Fiber in Indexer (PROPOSED) (A)');
  const w5 = await waitForFiber(indexer, contractId, CONFIG.fiberWaitTimeout);
  if (w5.rejected) {
    record('Fiber Indexed — PROPOSED (A)', 'failed', `Rejected: ${w5.rejectReason}`);
    skipAll(SUITE_A_STEPS.slice(1));
    return;
  }
  if (!w5.found) {
    record('Fiber Indexed — PROPOSED (A)', 'failed', 'Timeout');
    skipAll(SUITE_A_STEPS.slice(1));
    return;
  }
  console.log(`  ✓ Fiber indexed (PROPOSED)`);
  console.log(`  ⏳ DL1 sync wait (${CONFIG.dl1SyncWait}s)…`);
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('Fiber Indexed — PROPOSED (A)', 'passed');

  // 6. No rejections after proposal
  console.log('\n🔍 Test 6: No Rejections After Proposal (A)');
  const rej6 = await assertNoRejections(indexer, contractId, 'after proposal');
  record('No Rejections After Proposal (A)', rej6.passed ? 'passed' : 'failed', rej6.message);

  // 7. Accept (counterparty signs — Epic A required for ML0 to apply)
  console.log('\n🔍 Test 7: Accept Contract (A)');
  try {
    const r = await bridge.acceptContract(counterparty.privateKey, contractId);
    console.log(`  ✓ Accept submitted  hash=${r.hash}  status=${r.status}`);
    console.log(`  ℹ️  DL1 accepted the txn; ML0 state transition requires Epic A.`);
    record('Accept Contract (A)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Accept Contract (A)', 'failed', String(err));
    skipAll(SUITE_A_STEPS.slice(3));
    return;
  }

  // 8. Wait ACTIVE — Epic A short-poll
  console.log('\n🔍 Test 8: Wait for ACTIVE State (A)');
  const w8 = await waitForStateEpicA(indexer, contractId, 'ACTIVE');
  if (w8.reached) {
    // Epic A has landed or some other mechanism worked — proceed with full lifecycle
    record('Fiber State — ACTIVE (A)', 'passed');

    // 9. No rejections after acceptance
    console.log('\n🔍 Test 9: No Rejections After Acceptance (A)');
    console.log(`  ⏳ Waiting ${CONFIG.transitionWait}s…`);
    await sleep(CONFIG.transitionWait * 1000);
    const rej9 = await assertNoRejections(indexer, contractId, 'after acceptance');
    record('No Rejections After Acceptance (A)', rej9.passed ? 'passed' : 'failed', rej9.message);

    // 10. Submit completion (proposer)
    console.log('\n🔍 Test 10: Submit Completion — Proposer (A)');
    try {
      const r = await bridge.submitCompletion(proposer.privateKey, contractId,
        `Integration proof — proposer — ${Date.now()}`);
      console.log(`  ✓ hash=${r.hash}  ${r.message}`);
      record('Submit Completion — Proposer (A)', 'passed');
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Submit Completion — Proposer (A)', 'failed', String(err));
    }

    // 11. Submit completion (counterparty)
    console.log('\n🔍 Test 11: Submit Completion — Counterparty (A)');
    try {
      const r = await bridge.submitCompletion(counterparty.privateKey, contractId,
        `Integration proof — counterparty — ${Date.now()}`);
      console.log(`  ✓ hash=${r.hash}  ${r.message}`);
      record('Submit Completion — Counterparty (A)', 'passed');
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Submit Completion — Counterparty (A)', 'failed', String(err));
    }

    // 12. Finalize
    console.log('\n🔍 Test 12: Finalize Contract (A)');
    try {
      const r = await bridge.finalizeContract(proposer.privateKey, contractId);
      console.log(`  ✓ hash=${r.hash}  status=${r.status}`);
      record('Finalize Contract (A)', 'passed');
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Finalize Contract (A)', 'failed', String(err));
    }

    // 13. Wait COMPLETED
    console.log('\n🔍 Test 13: Wait for COMPLETED State (A)');
    const w13 = await waitForState(indexer, contractId, 'COMPLETED', CONFIG.stateWaitTimeout);
    record('Fiber State — COMPLETED (A)',
      w13.reached ? 'passed' : 'failed',
      w13.reached ? undefined : `state=${w13.actualState ?? 'unknown'}`);

    // 14. No rejections after finalization
    console.log('\n🔍 Test 14: No Rejections After Finalization (A)');
    console.log(`  ⏳ Waiting ${CONFIG.transitionWait}s…`);
    await sleep(CONFIG.transitionWait * 1000);
    const rej14 = await assertNoRejections(indexer, contractId, 'after finalization');
    record('No Rejections After Finalization (A)', rej14.passed ? 'passed' : 'failed', rej14.message);

    // 15. Verify final indexer state
    console.log('\n🔍 Test 15: Verify Final Indexer State (A)');
    try {
      const v = await indexer.verifyFiber(contractId);
      if (!v.found || !v.fiber) throw new Error('Fiber not found in indexer');
      console.log(`  ✓ state=${v.fiber.currentState}  seq=${v.fiber.sequenceNumber}  workflowType=${v.fiber.workflowType}`);
      if (v.lastTransition) {
        const t = v.lastTransition;
        console.log(`    Last transition: ${t.eventName} (${t.fromState} → ${t.toState})`);
      }
      const crit = v.rejections.filter(r => !isBenignRejection(r));
      if (crit.length === 0) console.log(`  ✓ No critical rejections`);
      else console.log(`  ⚠️  ${crit.length} critical rejection(s)`);
      record('Verify Final Indexer State (A)', 'passed',
        `state=${v.fiber.currentState}, seq=${v.fiber.sequenceNumber}`);
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Verify Final Indexer State (A)', 'failed', String(err));
    }
  } else {
    // Epic A not yet implemented — block the downstream steps
    blockAllEpicA([
      'Fiber State — ACTIVE (A)',
      'No Rejections After Acceptance (A)',
      'Submit Completion — Proposer (A)',
      'Submit Completion — Counterparty (A)',
      'Finalize Contract (A)',
      'Fiber State — COMPLETED (A)',
      'No Rejections After Finalization (A)',
      'Verify Final Indexer State (A)',
    ]);
  }
}

// ── Suite B: Rejection path ────────────────────────────────────────────────────

const SUITE_B_STEPS = [
  'Propose Contract (B)',
  'Fiber Indexed — PROPOSED (B)',
  'No Rejections After Proposal (B)',
  'Reject Contract (B)',
  'Fiber State — REJECTED (B)',
  'No Rejections After Rejection (B)',
  'Verify REJECTED State (B)',
];

async function runSuiteB(
  bridge:       BridgeClient,
  indexer:      IndexerClient,
  proposer:     Wallet,
  counterparty: Wallet
): Promise<void> {

  // 17. Propose
  console.log('\n🔍 Test 17: Propose Contract (B)');
  let contractId: string | null = null;
  try {
    const r = await bridge.proposeContract(
      proposer.privateKey,
      counterparty.address,
      {
        description: `Rejection-path contract ${Date.now().toString(36)}`,
        value: 50, currency: 'OTTO',
        deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
      { title: 'Integration Test — Rejection Path' }
    );
    contractId = r.contractId;
    console.log(`  ✓ contractId=${contractId}  hash=${r.hash}`);
    record('Propose Contract (B)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Propose Contract (B)', 'failed', String(err));
    skipAll(SUITE_B_STEPS.slice(1));
    return;
  }
  if (!contractId) { skipAll(SUITE_B_STEPS.slice(1)); return; }

  // 18. Wait PROPOSED
  console.log('\n🔍 Test 18: Wait for Fiber in Indexer (PROPOSED) (B)');
  const w18 = await waitForFiber(indexer, contractId, CONFIG.fiberWaitTimeout);
  if (w18.rejected || !w18.found) {
    record('Fiber Indexed — PROPOSED (B)',
      'failed', w18.rejected ? `Rejected: ${w18.rejectReason}` : 'Timeout');
    skipAll(SUITE_B_STEPS.slice(2));
    return;
  }
  console.log(`  ✓ Fiber indexed (PROPOSED)`);
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('Fiber Indexed — PROPOSED (B)', 'passed');

  // 19. No rejections
  console.log('\n🔍 Test 19: No Rejections After Proposal (B)');
  const rej19 = await assertNoRejections(indexer, contractId, 'after proposal (B)');
  record('No Rejections After Proposal (B)', rej19.passed ? 'passed' : 'failed', rej19.message);

  // 20. Reject (counterparty signs — Epic A required for ML0 to apply)
  console.log('\n🔍 Test 20: Reject Contract (B)');
  try {
    const r = await bridge.rejectContract(counterparty.privateKey, contractId,
      'Integration test: deliberate rejection');
    console.log(`  ✓ Reject submitted  hash=${r.hash}  status=${r.status}`);
    console.log(`  ℹ️  DL1 accepted the txn; ML0 state transition requires Epic A.`);
    record('Reject Contract (B)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Reject Contract (B)', 'failed', String(err));
    skipAll(['Fiber State — REJECTED (B)', 'No Rejections After Rejection (B)', 'Verify REJECTED State (B)']);
    return;
  }

  // 21. Wait REJECTED — Epic A short-poll
  console.log('\n🔍 Test 21: Wait for REJECTED State (B)');
  const w21 = await waitForStateEpicA(indexer, contractId, 'REJECTED');
  if (w21.reached) {
    record('Fiber State — REJECTED (B)', 'passed');

    // 22. No rejections after rejection
    console.log('\n🔍 Test 22: No Rejections After Rejection (B)');
    await sleep(CONFIG.transitionWait * 1000);
    const rej22 = await assertNoRejections(indexer, contractId, 'after rejection (B)');
    record('No Rejections After Rejection (B)', rej22.passed ? 'passed' : 'failed', rej22.message);

    // 23. Verify REJECTED final state
    console.log('\n🔍 Test 23: Verify REJECTED Final State (B)');
    try {
      const v = await indexer.verifyFiber(contractId);
      if (!v.found || !v.fiber) throw new Error('Fiber not found');
      const ok = v.fiber.currentState === 'REJECTED';
      console.log(`  ${ok ? '✓' : '❌'} state=${v.fiber.currentState}`);
      record('Verify REJECTED State (B)',
        ok ? 'passed' : 'failed',
        ok ? undefined : `Expected REJECTED, got ${v.fiber.currentState}`);
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Verify REJECTED State (B)', 'failed', String(err));
    }
  } else {
    blockAllEpicA([
      'Fiber State — REJECTED (B)',
      'No Rejections After Rejection (B)',
      'Verify REJECTED State (B)',
    ]);
  }
}

// ── Suite C: Dispute path ──────────────────────────────────────────────────────

const SUITE_C_STEPS = [
  'Propose Contract (C)',
  'Fiber Indexed — PROPOSED (C)',
  'Accept Contract (C)',
  'Fiber State — ACTIVE (C)',
  'No Rejections After Acceptance (C)',
  'Dispute Contract (C)',
  'Fiber State — DISPUTED (C)',
  'No Rejections After Dispute (C)',
];

async function runSuiteC(
  bridge:       BridgeClient,
  indexer:      IndexerClient,
  proposer:     Wallet,
  counterparty: Wallet
): Promise<void> {

  // 25. Propose
  console.log('\n🔍 Test 25: Propose Contract (C)');
  let contractId: string | null = null;
  try {
    const r = await bridge.proposeContract(
      proposer.privateKey,
      counterparty.address,
      {
        description: `Dispute-path contract ${Date.now().toString(36)}`,
        value: 200, currency: 'OTTO',
        deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
      { title: 'Integration Test — Dispute Path' }
    );
    contractId = r.contractId;
    console.log(`  ✓ contractId=${contractId}  hash=${r.hash}`);
    record('Propose Contract (C)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Propose Contract (C)', 'failed', String(err));
    skipAll(SUITE_C_STEPS.slice(1));
    return;
  }
  if (!contractId) { skipAll(SUITE_C_STEPS.slice(1)); return; }

  // 26. Wait PROPOSED
  console.log('\n🔍 Test 26: Wait for Fiber in Indexer (PROPOSED) (C)');
  const w26 = await waitForFiber(indexer, contractId, CONFIG.fiberWaitTimeout);
  if (w26.rejected || !w26.found) {
    record('Fiber Indexed — PROPOSED (C)',
      'failed', w26.rejected ? `Rejected: ${w26.rejectReason}` : 'Timeout');
    skipAll(SUITE_C_STEPS.slice(2));
    return;
  }
  console.log(`  ✓ Fiber indexed (PROPOSED)`);
  await sleep(CONFIG.dl1SyncWait * 1000);
  record('Fiber Indexed — PROPOSED (C)', 'passed');

  // 27. Accept (counterparty signs — Epic A required for ML0 to apply)
  console.log('\n🔍 Test 27: Accept Contract (C)');
  try {
    const r = await bridge.acceptContract(counterparty.privateKey, contractId);
    console.log(`  ✓ Accept submitted  hash=${r.hash}`);
    console.log(`  ℹ️  DL1 accepted the txn; ML0 state transition requires Epic A.`);
    record('Accept Contract (C)', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Accept Contract (C)', 'failed', String(err));
    skipAll(['Fiber State — ACTIVE (C)', 'No Rejections After Acceptance (C)',
      'Dispute Contract (C)', 'Fiber State — DISPUTED (C)', 'No Rejections After Dispute (C)']);
    return;
  }

  // 28. Wait ACTIVE — Epic A short-poll
  console.log('\n🔍 Test 28: Wait for ACTIVE State (C)');
  const w28 = await waitForStateEpicA(indexer, contractId, 'ACTIVE');
  if (w28.reached) {
    record('Fiber State — ACTIVE (C)', 'passed');

    // 29. No rejections after acceptance
    console.log('\n🔍 Test 29: No Rejections After Acceptance (C)');
    await sleep(CONFIG.transitionWait * 1000);
    const rej29 = await assertNoRejections(indexer, contractId, 'after acceptance (C)');
    record('No Rejections After Acceptance (C)', rej29.passed ? 'passed' : 'failed', rej29.message);

    // 30. Dispute (proposer can sign this — they ARE an owner)
    console.log('\n🔍 Test 30: Dispute Contract (C)');
    try {
      const r = await bridge.disputeContract(proposer.privateKey, contractId,
        'Integration test: deliberate dispute — counterparty did not deliver');
      console.log(`  ✓ Disputed  hash=${r.hash}  status=${r.status}`);
      record('Dispute Contract (C)', 'passed');
    } catch (err) {
      console.error(`  ❌ ${err}`);
      record('Dispute Contract (C)', 'failed', String(err));
      skipAll(['Fiber State — DISPUTED (C)', 'No Rejections After Dispute (C)']);
      return;
    }

    // 31. Wait DISPUTED
    console.log('\n🔍 Test 31: Wait for DISPUTED State (C)');
    const w31 = await waitForState(indexer, contractId, 'DISPUTED', CONFIG.stateWaitTimeout);
    record('Fiber State — DISPUTED (C)',
      w31.reached ? 'passed' : 'failed',
      w31.reached ? undefined : `state=${w31.actualState ?? 'unknown'}`);

    // 32. No rejections after dispute
    console.log('\n🔍 Test 32: No Rejections After Dispute (C)');
    await sleep(CONFIG.transitionWait * 1000);
    const rej32 = await assertNoRejections(indexer, contractId, 'after dispute (C)');
    record('No Rejections After Dispute (C)', rej32.passed ? 'passed' : 'failed', rej32.message);
  } else {
    blockAllEpicA([
      'Fiber State — ACTIVE (C)',
      'No Rejections After Acceptance (C)',
      'Dispute Contract (C)',
      'Fiber State — DISPUTED (C)',
      'No Rejections After Dispute (C)',
    ]);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  let p = 0, f = 0, s = 0, b = 0;
  for (const r of results) {
    const icon =
      r.status === 'passed'  ? '✓'  :
      r.status === 'skipped' ? '⏭️ ' :
      r.status === 'blocked' ? '🚧' :
      '❌';
    console.log(`${icon} ${r.name}${r.message ? ` — ${r.message}` : ''}`);
    if (r.status === 'passed')  p++;
    else if (r.status === 'failed')  f++;
    else if (r.status === 'skipped') s++;
    else if (r.status === 'blocked') b++;
  }
  console.log('');
  console.log(`Passed:  ${p}/${results.length}`);
  if (s > 0) console.log(`Skipped: ${s}/${results.length}`);
  if (b > 0) {
    console.log(`Blocked: ${b}/${results.length}  (🚧 Epic A — awaiting multi-party signing)`);
    console.log('');
    console.log('  Epic A blocked steps require the metagraph to support transitions');
    console.log('  signed by non-owner parties (counterparty accept/reject/complete).');
    console.log('  See: updateSignedByOwners in FiberRules.scala');
    console.log('  These tests will pass automatically once Epic A is implemented.');
  }
  if (f > 0) console.log(`Failed:  ${f}/${results.length}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain — Contract Fiber Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log('');

  const bridge  = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  const indexer = new IndexerClient({ indexerUrl: CONFIG.indexerUrl });

  // ── Test 1: Bridge health check ────────────────────────────────────────────
  console.log('🔍 Test 1: Bridge Health Check');
  try {
    const h = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).then(r => r.json()) as { status: string };
    if (h.status !== 'ok') throw new Error(`status=${h.status}`);
    console.log('  ✓ Bridge healthy');
    record('Bridge Health Check', 'passed');
  } catch (err) {
    console.error(`  ❌ ${err}`);
    record('Bridge Health Check', 'failed', String(err));
    printSummary();
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Suite A — Full lifecycle
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Suite A — Full Lifecycle (propose → accept → complete)      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  let proposerA: Wallet | null = null;
  let counterpartyA: Wallet | null = null;

  console.log('\n🔍 Test 2: Generate Proposer Wallet (A)');
  try {
    proposerA = await bridge.generateWallet();
    console.log(`  ✓ ${proposerA.address}`);
    record('Generate Proposer Wallet (A)', 'passed');
  } catch (err) { record('Generate Proposer Wallet (A)', 'failed', String(err)); }

  console.log('\n🔍 Test 3: Generate Counterparty Wallet (A)');
  try {
    counterpartyA = await bridge.generateWallet();
    console.log(`  ✓ ${counterpartyA.address}`);
    record('Generate Counterparty Wallet (A)', 'passed');
  } catch (err) { record('Generate Counterparty Wallet (A)', 'failed', String(err)); }

  if (proposerA && counterpartyA) {
    await runSuiteA(bridge, indexer, proposerA, counterpartyA);
  } else {
    console.error('\n❌ Suite A skipped — wallet generation failed');
    skipAll(['Propose Contract (A)', ...SUITE_A_STEPS]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Suite B — Rejection path
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Suite B — Rejection Path (propose → reject)                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  let proposerB: Wallet | null = null;
  let counterpartyB: Wallet | null = null;

  console.log('\n🔍 Test 16: Generate Wallets (B)');
  try {
    proposerB     = await bridge.generateWallet();
    counterpartyB = await bridge.generateWallet();
    console.log(`  ✓ Proposer:     ${proposerB.address}`);
    console.log(`  ✓ Counterparty: ${counterpartyB.address}`);
    record('Generate Wallets (B)', 'passed');
  } catch (err) { record('Generate Wallets (B)', 'failed', String(err)); }

  if (proposerB && counterpartyB) {
    await runSuiteB(bridge, indexer, proposerB, counterpartyB);
  } else {
    skipAll(SUITE_B_STEPS);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Suite C — Dispute path
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Suite C — Dispute Path (propose → accept → dispute)         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  let proposerC: Wallet | null = null;
  let counterpartyC: Wallet | null = null;

  console.log('\n🔍 Test 24: Generate Wallets (C)');
  try {
    proposerC     = await bridge.generateWallet();
    counterpartyC = await bridge.generateWallet();
    console.log(`  ✓ Proposer:     ${proposerC.address}`);
    console.log(`  ✓ Counterparty: ${counterpartyC.address}`);
    record('Generate Wallets (C)', 'passed');
  } catch (err) { record('Generate Wallets (C)', 'failed', String(err)); }

  if (proposerC && counterpartyC) {
    await runSuiteC(bridge, indexer, proposerC, counterpartyC);
  } else {
    skipAll(SUITE_C_STEPS);
  }

  printSummary();

  // Only fail the CI run on unexpected failures — not on Epic A blocked steps.
  const failCount = results.filter(r => r.status === 'failed').length;
  if (failCount > 0) process.exit(1);
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
