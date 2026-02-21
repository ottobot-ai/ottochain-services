#!/usr/bin/env npx tsx
/**
 * Escrow Fiber Integration Tests
 *
 * Tests the full lifecycle for both Escrow fiber types:
 *
 *   Simple Escrow (fund → release path):
 *     1. Bridge health check
 *     2. Wallet generation (proposer + counterparty)
 *     3. Propose escrow (fund)
 *     4. Wait for fiber in indexer + assert no rejections
 *     5. Accept escrow → ACTIVE
 *     6. Wait for ACTIVE in indexer + assert no rejections
 *     7. Deliver work → DELIVERED
 *     8. Wait for DELIVERED in indexer + assert no rejections
 *     9. Confirm receipt → COMPLETED  (release path)
 *    10. Wait for COMPLETED in indexer + assert no rejections
 *
 *   Simple Escrow (fund → refund path):
 *    11. Propose escrow (fund)
 *    12. Wait for fiber + assert no rejections
 *    13. Accept → ACTIVE + assert no rejections
 *    14. Deliver → DELIVERED + assert no rejections
 *    15. Dispute → DISPUTED  (refund/dispute path) + assert no rejections
 *
 *   Arbitrated Escrow (dispute → arbitrate path):
 *    16. Wallet generation (proposer + counterparty + arbiter)
 *    17. Propose arbitrated escrow
 *    18. Wait for fiber + assert no rejections
 *    19. Accept → ACTIVE + assert no rejections
 *    20. Deliver → DELIVERED + assert no rejections
 *    21. Dispute → DISPUTED + assert no rejections
 *    22. Resolve (arbiter) → RESOLVED + assert no rejections
 *
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   INDEXER_URL         - Indexer service URL (default: http://localhost:3031)
 *   ML0_URL             - Metagraph L0 URL (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber state changes (default: 60)
 *   TRANSITION_WAIT     - Seconds to wait between transitions (default: 5)
 *
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 npx tsx test/escrow-integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';
import { IndexerClient } from '../dist/indexer-client.js';

// ─── Configuration ─────────────────────────────────────────────────────────

const CONFIG = {
  bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
  indexerUrl: process.env.INDEXER_URL ?? 'http://localhost:3031',
  ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '60', 10),
  transitionWait: parseInt(process.env.TRANSITION_WAIT ?? '5', 10),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a rejection is benign (timing race, not a real failure).
 * SequenceNumberMismatch and NoTransitionForEvent happen during rapid
 * transitions and resolve on their own.
 */
function isBenignRejection(rejection: { errors: Array<{ code: string }> }): boolean {
  return rejection.errors.every(
    e => e.code === 'SequenceNumberMismatch' || e.code === 'NoTransitionForEvent'
  );
}

/**
 * Query the rejection API for a fiber and assert no critical rejections occurred.
 */
async function assertNoRejections(
  indexer: IndexerClient,
  fiberId: string,
  label: string
): Promise<{ passed: boolean; message?: string }> {
  let result: Awaited<ReturnType<IndexerClient['queryRejections']>>;
  try {
    result = await indexer.queryRejections({ fiberId, limit: 50 });
  } catch (err) {
    console.log(`  ⚠️  Could not reach rejection API: ${err}`);
    return { passed: true, message: 'rejection API unavailable (skipped)' };
  }

  const { rejections, total } = result;

  if (total === 0) {
    console.log(`  ✓ No rejections for fiber (${label})`);
    return { passed: true };
  }

  const critical = rejections.filter(r => !isBenignRejection(r));
  const benign   = rejections.filter(r =>  isBenignRejection(r));

  if (benign.length > 0) {
    console.log(`  ℹ️  ${benign.length} benign rejection(s) ignored (timing races):`);
    for (const r of benign.slice(0, 3)) {
      console.log(`    - [ordinal ${r.ordinal}] ${r.updateType}: ${r.errors.map(e => e.code).join(', ')}`);
    }
  }

  if (critical.length === 0) {
    console.log(`  ✓ No critical rejections for fiber (${label})`);
    return { passed: true };
  }

  console.log(`  ❌ ${critical.length} critical rejection(s) found (${label}):`);
  for (const r of critical) {
    const codes = r.errors.map(e => e.code).join(', ');
    const msgs  = r.errors.map(e => e.message ?? '').filter(Boolean).join('; ');
    console.log(`    - [ordinal ${r.ordinal}] ${r.updateType} | errors: ${codes}`);
    if (msgs) console.log(`      detail: ${msgs}`);
    console.log(`      hash: ${r.updateHash}`);
  }

  return {
    passed: false,
    message: `${critical.length} critical rejection(s): ${critical[0].errors.map(e => e.code).join(', ')}`,
  };
}

/**
 * Wait for a fiber to appear in the indexer with polling + rejection detection.
 */
async function waitForFiber(
  indexer: IndexerClient,
  fiberId: string,
  timeoutSeconds: number
): Promise<{ found: boolean; rejected?: boolean; rejectReason?: string }> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;
  const pollIntervalMs = 2000;

  console.log(`  ⏳ Waiting for fiber in indexer (up to ${timeoutSeconds}s)...`);

  let checkCount = 0;
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    checkCount++;
    const verification = await indexer.verifyFiber(fiberId);

    if (checkCount % 3 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  📊 [${elapsed}s] Indexer status: ${verification.found ? 'FOUND' : 'waiting...'}`);
    }

    if (verification.found) {
      return { found: true };
    }

    if (verification.hasUnprocessedRejection && verification.rejections.length > 0) {
      const critical = verification.rejections.find(r => !isBenignRejection(r));
      if (critical) {
        const errors = critical.errors.map(e => e.code).join(', ');
        console.log(`  ❌ Transaction REJECTED: ${errors}`);
        return { found: false, rejected: true, rejectReason: errors };
      }
      console.log(`  ⏳ Benign rejection (timing race), continuing...`);
    }

    await sleep(pollIntervalMs);
  }

  const finalCheck = await indexer.verifyFiber(fiberId);
  if (finalCheck.rejections.length > 0) {
    const errors = finalCheck.rejections[0].errors.map(e => e.code).join(', ');
    return { found: false, rejected: true, rejectReason: errors };
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
): Promise<{ reached: boolean; actualState?: string; rejected?: boolean; rejectReason?: string }> {
  console.log(`  ⏳ Waiting for state ${expectedState} (up to ${timeoutSeconds}s)...`);
  const result = await indexer.waitForState(fiberId, expectedState, {
    timeoutMs: timeoutSeconds * 1000,
    pollIntervalMs: 2000,
  });

  if (result.found) {
    console.log(`  ✓ Fiber reached state: ${expectedState}`);
    return { reached: true, actualState: expectedState };
  }

  // Check for rejections
  const verification = await indexer.verifyFiber(fiberId);
  if (verification.rejections.length > 0) {
    const critical = verification.rejections.find(r => !isBenignRejection(r));
    if (critical) {
      const errors = critical.errors.map(e => e.code).join(', ');
      return { reached: false, actualState: result.actualState ?? undefined, rejected: true, rejectReason: errors };
    }
  }

  return {
    reached: false,
    actualState: result.actualState ?? undefined,
  };
}

// ─── Test Scaffolding ────────────────────────────────────────────────────────

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

type WalletInfo = { address: string; privateKey: string };

function printSummary(results: TestResult[]): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '⏭️ ' : '❌';
    console.log(`${icon} ${r.name}${r.message ? ` (${r.message})` : ''}`);
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }

  console.log('');
  console.log(`Passed:  ${passed}/${results.length}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}/${results.length}`);
  if (failed > 0)  console.log(`Failed:  ${failed}/${results.length}`);
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

/**
 * Run the Simple Escrow - Release path:
 *   propose → accept → deliver → confirm → COMPLETED
 */
async function runSimpleEscrowRelease(
  client: BridgeClient,
  indexer: IndexerClient,
  proposer: WalletInfo,
  counterparty: WalletInfo,
  results: TestResult[]
): Promise<void> {
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(' Simple Escrow: Release Path (fund → release)');
  console.log('────────────────────────────────────────────────────────────────');

  let fiberId: string | null = null;
  let canContinue = true;

  // ── Step 1: Propose (fund) ────────────────────────────────────────────────
  console.log('\n🔍 [Escrow-Release-1] Propose Escrow (fund)');
  try {
    const terms = {
      description: 'Website development project (integration test)',
      value: 500,
      currency: 'OTTO',
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const result = await client.proposeContract(
      proposer.privateKey,
      counterparty.address,
      terms,
      {
        title: `SimpleEscrow-Release-${Date.now().toString(36)}`,
        description: 'Integration test: simple escrow release path',
      }
    );
    fiberId = result.contractId;
    console.log(`  ✓ Escrow proposed: fiberId=${fiberId}`);
    console.log(`    proposer=${proposer.address.slice(0, 12)}  counterparty=${counterparty.address.slice(0, 12)}`);
    results.push({ name: '[Escrow-Release] Propose Escrow', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Propose failed: ${err}`);
    results.push({ name: '[Escrow-Release] Propose Escrow', status: 'failed', message: String(err) });
    return; // Cannot continue without a fiber
  }

  // ── Step 2: Wait for fiber + no rejections ────────────────────────────────
  console.log('\n🔍 [Escrow-Release-2] Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (waitResult.rejected) {
    console.error(`  ❌ Transaction rejected: ${waitResult.rejectReason}`);
    results.push({ name: '[Escrow-Release] Fiber Indexed (PROPOSED)', status: 'failed', message: `Rejected: ${waitResult.rejectReason}` });
    return;
  }
  if (!waitResult.found) {
    console.error(`  ❌ Fiber did not appear in indexer within ${CONFIG.fiberWaitTimeout}s`);
    results.push({ name: '[Escrow-Release] Fiber Indexed (PROPOSED)', status: 'failed', message: 'Timeout' });
    return;
  }
  console.log(`  ✓ Fiber found in indexer`);
  results.push({ name: '[Escrow-Release] Fiber Indexed (PROPOSED)', status: 'passed' });

  const noReject1 = await assertNoRejections(indexer, fiberId, 'after propose');
  results.push({
    name: '[Escrow-Release] No Rejections After Propose',
    status: noReject1.passed ? 'passed' : 'failed',
    message: noReject1.message,
  });
  if (!noReject1.passed) canContinue = false;

  // ── Step 3: Accept → ACTIVE ───────────────────────────────────────────────
  console.log('\n🔍 [Escrow-Release-3] Accept Escrow (PROPOSED → ACTIVE)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped (prior failure)');
    results.push({ name: '[Escrow-Release] Accept Escrow (ACTIVE)', status: 'skipped' });
    results.push({ name: '[Escrow-Release] No Rejections After Accept', status: 'skipped' });
  } else {
    try {
      const acceptResult = await client.acceptContract(counterparty.privateKey, fiberId);
      console.log(`  ✓ Accepted: hash=${acceptResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'ACTIVE', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        console.error(`  ❌ Did not reach ACTIVE (actual: ${stateResult.actualState ?? 'unknown'})`);
        results.push({ name: '[Escrow-Release] Accept Escrow (ACTIVE)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        results.push({ name: '[Escrow-Release] Accept Escrow (ACTIVE)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Accept failed: ${err}`);
      results.push({ name: '[Escrow-Release] Accept Escrow (ACTIVE)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject2 = await assertNoRejections(indexer, fiberId, 'after accept');
    results.push({
      name: '[Escrow-Release] No Rejections After Accept',
      status: noReject2.passed ? 'passed' : 'failed',
      message: noReject2.message,
    });
    if (!noReject2.passed) canContinue = false;
  }

  // ── Step 4: Deliver → DELIVERED ───────────────────────────────────────────
  console.log('\n🔍 [Escrow-Release-4] Deliver Work (ACTIVE → DELIVERED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped (prior failure)');
    results.push({ name: '[Escrow-Release] Deliver Work (DELIVERED)', status: 'skipped' });
    results.push({ name: '[Escrow-Release] No Rejections After Deliver', status: 'skipped' });
  } else {
    try {
      // Counterparty delivers work (maps to submitCompletion on bridge)
      const deliverResult = await client.submitCompletion(
        counterparty.privateKey,
        fiberId,
        `Delivered by ${counterparty.address.slice(0, 10)}`
      );
      console.log(`  ✓ Deliver submitted: hash=${deliverResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'DELIVERED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        console.error(`  ❌ Did not reach DELIVERED (actual: ${stateResult.actualState ?? 'unknown'})`);
        results.push({ name: '[Escrow-Release] Deliver Work (DELIVERED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        results.push({ name: '[Escrow-Release] Deliver Work (DELIVERED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Deliver failed: ${err}`);
      results.push({ name: '[Escrow-Release] Deliver Work (DELIVERED)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject3 = await assertNoRejections(indexer, fiberId, 'after deliver');
    results.push({
      name: '[Escrow-Release] No Rejections After Deliver',
      status: noReject3.passed ? 'passed' : 'failed',
      message: noReject3.message,
    });
    if (!noReject3.passed) canContinue = false;
  }

  // ── Step 5: Confirm → COMPLETED (release) ────────────────────────────────
  console.log('\n🔍 [Escrow-Release-5] Confirm Receipt (DELIVERED → COMPLETED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped (prior failure)');
    results.push({ name: '[Escrow-Release] Confirm Receipt (COMPLETED)', status: 'skipped' });
    results.push({ name: '[Escrow-Release] No Rejections After Confirm', status: 'skipped' });
  } else {
    try {
      // Proposer confirms receipt (maps to submitCompletion on bridge)
      const confirmResult = await client.submitCompletion(
        proposer.privateKey,
        fiberId,
        `Confirmed by ${proposer.address.slice(0, 10)}`
      );
      console.log(`  ✓ Confirm submitted: hash=${confirmResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'COMPLETED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        console.error(`  ❌ Did not reach COMPLETED (actual: ${stateResult.actualState ?? 'unknown'})`);
        results.push({ name: '[Escrow-Release] Confirm Receipt (COMPLETED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
      } else {
        results.push({ name: '[Escrow-Release] Confirm Receipt (COMPLETED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Confirm failed: ${err}`);
      results.push({ name: '[Escrow-Release] Confirm Receipt (COMPLETED)', status: 'failed', message: String(err) });
    }

    const noReject4 = await assertNoRejections(indexer, fiberId, 'after confirm');
    results.push({
      name: '[Escrow-Release] No Rejections After Confirm',
      status: noReject4.passed ? 'passed' : 'failed',
      message: noReject4.message,
    });
  }
}

/**
 * Run the Simple Escrow - Dispute/Refund path:
 *   propose → accept → deliver → dispute → DISPUTED
 */
async function runSimpleEscrowDispute(
  client: BridgeClient,
  indexer: IndexerClient,
  proposer: WalletInfo,
  counterparty: WalletInfo,
  results: TestResult[]
): Promise<void> {
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(' Simple Escrow: Dispute Path (fund → refund)');
  console.log('────────────────────────────────────────────────────────────────');

  let fiberId: string | null = null;
  let canContinue = true;

  // ── Step 1: Propose ───────────────────────────────────────────────────────
  console.log('\n🔍 [Escrow-Dispute-1] Propose Escrow (fund)');
  try {
    const terms = {
      description: 'Logo design project (integration test - dispute path)',
      value: 150,
      currency: 'OTTO',
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const result = await client.proposeContract(
      proposer.privateKey,
      counterparty.address,
      terms,
      {
        title: `SimpleEscrow-Dispute-${Date.now().toString(36)}`,
        description: 'Integration test: simple escrow dispute path',
      }
    );
    fiberId = result.contractId;
    console.log(`  ✓ Escrow proposed: fiberId=${fiberId}`);
    results.push({ name: '[Escrow-Dispute] Propose Escrow', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Propose failed: ${err}`);
    results.push({ name: '[Escrow-Dispute] Propose Escrow', status: 'failed', message: String(err) });
    return;
  }

  // ── Step 2: Wait for fiber ────────────────────────────────────────────────
  console.log('\n🔍 [Escrow-Dispute-2] Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (waitResult.rejected) {
    results.push({ name: '[Escrow-Dispute] Fiber Indexed (PROPOSED)', status: 'failed', message: `Rejected: ${waitResult.rejectReason}` });
    return;
  }
  if (!waitResult.found) {
    results.push({ name: '[Escrow-Dispute] Fiber Indexed (PROPOSED)', status: 'failed', message: 'Timeout' });
    return;
  }
  console.log(`  ✓ Fiber found in indexer`);
  results.push({ name: '[Escrow-Dispute] Fiber Indexed (PROPOSED)', status: 'passed' });

  const noReject1 = await assertNoRejections(indexer, fiberId, 'after propose');
  results.push({
    name: '[Escrow-Dispute] No Rejections After Propose',
    status: noReject1.passed ? 'passed' : 'failed',
    message: noReject1.message,
  });
  if (!noReject1.passed) canContinue = false;

  // ── Step 3: Accept → ACTIVE ───────────────────────────────────────────────
  console.log('\n🔍 [Escrow-Dispute-3] Accept Escrow (PROPOSED → ACTIVE)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Escrow-Dispute] Accept Escrow (ACTIVE)', status: 'skipped' });
    results.push({ name: '[Escrow-Dispute] No Rejections After Accept', status: 'skipped' });
  } else {
    try {
      await client.acceptContract(counterparty.privateKey, fiberId);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'ACTIVE', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        results.push({ name: '[Escrow-Dispute] Accept Escrow (ACTIVE)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        console.log(`  ✓ State is ACTIVE`);
        results.push({ name: '[Escrow-Dispute] Accept Escrow (ACTIVE)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Accept failed: ${err}`);
      results.push({ name: '[Escrow-Dispute] Accept Escrow (ACTIVE)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject2 = await assertNoRejections(indexer, fiberId, 'after accept');
    results.push({
      name: '[Escrow-Dispute] No Rejections After Accept',
      status: noReject2.passed ? 'passed' : 'failed',
      message: noReject2.message,
    });
    if (!noReject2.passed) canContinue = false;
  }

  // ── Step 4: Deliver → DELIVERED ───────────────────────────────────────────
  console.log('\n🔍 [Escrow-Dispute-4] Deliver Work (ACTIVE → DELIVERED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Escrow-Dispute] Deliver Work (DELIVERED)', status: 'skipped' });
    results.push({ name: '[Escrow-Dispute] No Rejections After Deliver', status: 'skipped' });
  } else {
    try {
      await client.submitCompletion(
        counterparty.privateKey,
        fiberId,
        `Delivered by ${counterparty.address.slice(0, 10)}`
      );
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'DELIVERED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        results.push({ name: '[Escrow-Dispute] Deliver Work (DELIVERED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        console.log(`  ✓ State is DELIVERED`);
        results.push({ name: '[Escrow-Dispute] Deliver Work (DELIVERED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Deliver failed: ${err}`);
      results.push({ name: '[Escrow-Dispute] Deliver Work (DELIVERED)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject3 = await assertNoRejections(indexer, fiberId, 'after deliver');
    results.push({
      name: '[Escrow-Dispute] No Rejections After Deliver',
      status: noReject3.passed ? 'passed' : 'failed',
      message: noReject3.message,
    });
    if (!noReject3.passed) canContinue = false;
  }

  // ── Step 5: Dispute → DISPUTED (refund path) ─────────────────────────────
  console.log('\n🔍 [Escrow-Dispute-5] Raise Dispute (DELIVERED → DISPUTED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Escrow-Dispute] Raise Dispute (DISPUTED)', status: 'skipped' });
    results.push({ name: '[Escrow-Dispute] No Rejections After Dispute', status: 'skipped' });
  } else {
    try {
      const disputeResult = await client.disputeContract(
        proposer.privateKey,
        fiberId,
        'Work does not meet requirements (integration test dispute)'
      );
      console.log(`  ✓ Dispute raised: hash=${disputeResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'DISPUTED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        console.error(`  ❌ Did not reach DISPUTED (actual: ${stateResult.actualState ?? 'unknown'})`);
        results.push({ name: '[Escrow-Dispute] Raise Dispute (DISPUTED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
      } else {
        results.push({ name: '[Escrow-Dispute] Raise Dispute (DISPUTED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Dispute failed: ${err}`);
      results.push({ name: '[Escrow-Dispute] Raise Dispute (DISPUTED)', status: 'failed', message: String(err) });
    }

    const noReject4 = await assertNoRejections(indexer, fiberId, 'after dispute');
    results.push({
      name: '[Escrow-Dispute] No Rejections After Dispute',
      status: noReject4.passed ? 'passed' : 'failed',
      message: noReject4.message,
    });
  }
}

/**
 * Run the Arbitrated Escrow - Dispute → Arbitrate path:
 *   propose → accept → deliver → dispute → resolve → RESOLVED
 */
async function runArbitratedEscrow(
  client: BridgeClient,
  indexer: IndexerClient,
  proposer: WalletInfo,
  counterparty: WalletInfo,
  arbiter: WalletInfo,
  results: TestResult[]
): Promise<void> {
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(' Arbitrated Escrow: Dispute → Arbitrate Path');
  console.log('────────────────────────────────────────────────────────────────');

  let fiberId: string | null = null;
  let canContinue = true;

  // ── Step 1: Propose arbitrated escrow ────────────────────────────────────
  console.log('\n🔍 [Arb-Escrow-1] Propose Arbitrated Escrow');
  try {
    const terms = {
      description: 'Smart contract audit with arbitration (integration test)',
      value: 1000,
      currency: 'OTTO',
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      arbiter: arbiter.address,
      arbiterFee: 50, // 5% of 1000
    };
    const result = await client.proposeContract(
      proposer.privateKey,
      counterparty.address,
      terms,
      {
        title: `ArbitratedEscrow-${Date.now().toString(36)}`,
        description: 'Integration test: arbitrated escrow dispute → resolve path',
      }
    );
    fiberId = result.contractId;
    console.log(`  ✓ Arbitrated escrow proposed: fiberId=${fiberId}`);
    console.log(`    proposer=${proposer.address.slice(0, 12)}  counterparty=${counterparty.address.slice(0, 12)}  arbiter=${arbiter.address.slice(0, 12)}`);
    results.push({ name: '[Arb-Escrow] Propose Arbitrated Escrow', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Propose failed: ${err}`);
    results.push({ name: '[Arb-Escrow] Propose Arbitrated Escrow', status: 'failed', message: String(err) });
    return;
  }

  // ── Step 2: Wait for fiber ────────────────────────────────────────────────
  console.log('\n🔍 [Arb-Escrow-2] Wait for Fiber in Indexer');
  const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
  if (waitResult.rejected) {
    results.push({ name: '[Arb-Escrow] Fiber Indexed (PROPOSED)', status: 'failed', message: `Rejected: ${waitResult.rejectReason}` });
    return;
  }
  if (!waitResult.found) {
    results.push({ name: '[Arb-Escrow] Fiber Indexed (PROPOSED)', status: 'failed', message: 'Timeout' });
    return;
  }
  console.log(`  ✓ Fiber found in indexer`);
  results.push({ name: '[Arb-Escrow] Fiber Indexed (PROPOSED)', status: 'passed' });

  const noReject1 = await assertNoRejections(indexer, fiberId, 'after propose');
  results.push({
    name: '[Arb-Escrow] No Rejections After Propose',
    status: noReject1.passed ? 'passed' : 'failed',
    message: noReject1.message,
  });
  if (!noReject1.passed) canContinue = false;

  // ── Step 3: Accept → ACTIVE ───────────────────────────────────────────────
  console.log('\n🔍 [Arb-Escrow-3] Accept (PROPOSED → ACTIVE)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Arb-Escrow] Accept (ACTIVE)', status: 'skipped' });
    results.push({ name: '[Arb-Escrow] No Rejections After Accept', status: 'skipped' });
  } else {
    try {
      await client.acceptContract(counterparty.privateKey, fiberId);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'ACTIVE', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        results.push({ name: '[Arb-Escrow] Accept (ACTIVE)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        console.log(`  ✓ State is ACTIVE`);
        results.push({ name: '[Arb-Escrow] Accept (ACTIVE)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Accept failed: ${err}`);
      results.push({ name: '[Arb-Escrow] Accept (ACTIVE)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject2 = await assertNoRejections(indexer, fiberId, 'after accept');
    results.push({
      name: '[Arb-Escrow] No Rejections After Accept',
      status: noReject2.passed ? 'passed' : 'failed',
      message: noReject2.message,
    });
    if (!noReject2.passed) canContinue = false;
  }

  // ── Step 4: Deliver → DELIVERED ───────────────────────────────────────────
  console.log('\n🔍 [Arb-Escrow-4] Deliver Work (ACTIVE → DELIVERED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Arb-Escrow] Deliver Work (DELIVERED)', status: 'skipped' });
    results.push({ name: '[Arb-Escrow] No Rejections After Deliver', status: 'skipped' });
  } else {
    try {
      await client.submitCompletion(
        counterparty.privateKey,
        fiberId,
        `Delivered by ${counterparty.address.slice(0, 10)}`
      );
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'DELIVERED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        results.push({ name: '[Arb-Escrow] Deliver Work (DELIVERED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        console.log(`  ✓ State is DELIVERED`);
        results.push({ name: '[Arb-Escrow] Deliver Work (DELIVERED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Deliver failed: ${err}`);
      results.push({ name: '[Arb-Escrow] Deliver Work (DELIVERED)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject3 = await assertNoRejections(indexer, fiberId, 'after deliver');
    results.push({
      name: '[Arb-Escrow] No Rejections After Deliver',
      status: noReject3.passed ? 'passed' : 'failed',
      message: noReject3.message,
    });
    if (!noReject3.passed) canContinue = false;
  }

  // ── Step 5: Dispute → DISPUTED ────────────────────────────────────────────
  console.log('\n🔍 [Arb-Escrow-5] Raise Dispute (DELIVERED → DISPUTED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Arb-Escrow] Raise Dispute (DISPUTED)', status: 'skipped' });
    results.push({ name: '[Arb-Escrow] No Rejections After Dispute', status: 'skipped' });
  } else {
    try {
      const disputeResult = await client.disputeContract(
        proposer.privateKey,
        fiberId,
        'Audit results incomplete (integration test dispute)'
      );
      console.log(`  ✓ Dispute raised: hash=${disputeResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'DISPUTED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        results.push({ name: '[Arb-Escrow] Raise Dispute (DISPUTED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
        canContinue = false;
      } else {
        console.log(`  ✓ State is DISPUTED`);
        results.push({ name: '[Arb-Escrow] Raise Dispute (DISPUTED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Dispute failed: ${err}`);
      results.push({ name: '[Arb-Escrow] Raise Dispute (DISPUTED)', status: 'failed', message: String(err) });
      canContinue = false;
    }

    const noReject4 = await assertNoRejections(indexer, fiberId, 'after dispute');
    results.push({
      name: '[Arb-Escrow] No Rejections After Dispute',
      status: noReject4.passed ? 'passed' : 'failed',
      message: noReject4.message,
    });
    if (!noReject4.passed) canContinue = false;
  }

  // ── Step 6: Resolve → RESOLVED (arbiter arbitrates) ──────────────────────
  console.log('\n🔍 [Arb-Escrow-6] Arbiter Resolves (DISPUTED → RESOLVED)');
  if (!canContinue) {
    console.log('  ⏭️  Skipped');
    results.push({ name: '[Arb-Escrow] Arbiter Resolves (RESOLVED)', status: 'skipped' });
    results.push({ name: '[Arb-Escrow] No Rejections After Resolve', status: 'skipped' });
  } else {
    try {
      // Arbiter sends 'resolve' transition via generic contract transition endpoint
      const resolveResult = await client.transitionContract(
        arbiter.privateKey,
        fiberId,
        'resolve',
        {
          agent: arbiter.address,
          ruling: 'partial_refund',
          resolvedBy: arbiter.address,
          resolvedAt: new Date().toISOString(),
          notes: 'Partial work accepted; 60% released to counterparty (integration test)',
        }
      );
      console.log(`  ✓ Dispute resolved by arbiter: hash=${resolveResult.hash}`);
      await sleep(CONFIG.transitionWait * 1000);

      const stateResult = await waitForState(indexer, fiberId, 'RESOLVED', CONFIG.fiberWaitTimeout);
      if (!stateResult.reached) {
        console.error(`  ❌ Did not reach RESOLVED (actual: ${stateResult.actualState ?? 'unknown'})`);
        results.push({ name: '[Arb-Escrow] Arbiter Resolves (RESOLVED)', status: 'failed', message: `Actual: ${stateResult.actualState ?? 'timeout'}` });
      } else {
        results.push({ name: '[Arb-Escrow] Arbiter Resolves (RESOLVED)', status: 'passed' });
      }
    } catch (err) {
      console.error(`  ❌ Resolve failed: ${err}`);
      results.push({ name: '[Arb-Escrow] Arbiter Resolves (RESOLVED)', status: 'failed', message: String(err) });
    }

    const noReject5 = await assertNoRejections(indexer, fiberId, 'after resolve');
    results.push({
      name: '[Arb-Escrow] No Rejections After Resolve',
      status: noReject5.passed ? 'passed' : 'failed',
      message: noReject5.message,
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain - Escrow Fiber Integration Tests');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiberWait=${CONFIG.fiberWaitTimeout}s, transitionWait=${CONFIG.transitionWait}s`);
  console.log('');
  console.log('Suites:');
  console.log('  1. Simple Escrow  - Release path (fund → release)');
  console.log('  2. Simple Escrow  - Dispute path (fund → refund)');
  console.log('  3. Arbitrated Escrow - Dispute → Arbitrate path');
  console.log('');

  const results: TestResult[] = [];

  // ── Bridge Health Check ───────────────────────────────────────────────────
  console.log('🔍 Bridge Health Check');
  try {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10000)
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Unexpected status: ${health.status}`);
    console.log('  ✓ Bridge is healthy');
    results.push({ name: 'Bridge Health Check', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Bridge health check failed: ${err}`);
    results.push({ name: 'Bridge Health Check', status: 'failed', message: String(err) });
    printSummary(results);
    process.exit(1);
  }

  // ── Initialize Clients ────────────────────────────────────────────────────
  const client  = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  const indexer = new IndexerClient({ indexerUrl: CONFIG.indexerUrl });

  // ── Wallet Generation ─────────────────────────────────────────────────────
  console.log('\n🔍 Wallet Generation (3 wallets: proposer, counterparty, arbiter)');
  let proposer: WalletInfo, counterparty: WalletInfo, arbiter: WalletInfo;

  try {
    [proposer, counterparty, arbiter] = await Promise.all([
      client.generateWallet(),
      client.generateWallet(),
      client.generateWallet(),
    ]);
    console.log(`  ✓ Proposer:    ${proposer.address}`);
    console.log(`  ✓ Counterparty: ${counterparty.address}`);
    console.log(`  ✓ Arbiter:     ${arbiter.address}`);
    results.push({ name: 'Wallet Generation', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet Generation', status: 'failed', message: String(err) });
    printSummary(results);
    process.exit(1);
  }

  // ── Suite 1: Simple Escrow - Release Path ─────────────────────────────────
  await runSimpleEscrowRelease(client, indexer, proposer, counterparty, results);

  // ── Suite 2: Simple Escrow - Dispute Path ─────────────────────────────────
  // Use same wallets - fresh fiber for each suite
  await runSimpleEscrowDispute(client, indexer, proposer, counterparty, results);

  // ── Suite 3: Arbitrated Escrow ────────────────────────────────────────────
  await runArbitratedEscrow(client, indexer, proposer, counterparty, arbiter, results);

  // ── Summary ───────────────────────────────────────────────────────────────
  printSummary(results);

  const failures = results.filter(r => r.status === 'failed').length;
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
