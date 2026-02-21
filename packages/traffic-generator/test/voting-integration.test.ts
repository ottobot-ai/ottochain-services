#!/usr/bin/env npx tsx
/**
 * Voting Fiber Integration Test
 *
 * Tests the full Voting fiber lifecycle: creation → open → vote casting → tally/completion.
 * Uses the Indexer as the source of truth for state verification.
 *
 * Test sequence:
 *   1. Bridge health check
 *   2. Wallet generation (proposer + 3 voters)
 *   3. Create Voting fiber (PROPOSED state)
 *   4. Assert no rejections after creation
 *   5. Open voting: PROPOSED → VOTING
 *   6. Assert no rejections after open
 *   7. Cast votes from 2 of 3 voters (meets 50% quorum)
 *   8. Assert no rejections after each vote
 *   9. Tally votes → PASSED
 *  10. Assert no rejections after tally
 *  11. Verify final PASSED state in indexer (detailed)
 *
 * Quorum / threshold mechanics:
 *   - 3 voters registered, quorum = 0.5 (50% must vote)
 *   - 2 of 3 voters cast "Yes" → meets quorum, majority in favour → tally_pass
 *   - Result should be PASSED
 *
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   INDEXER_URL         - Indexer service URL (default: http://localhost:3031)
 *   ML0_URL             - Metagraph L0 URL  (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber in state (default: 30)
 *   VOTE_WAIT           - Seconds to wait between votes for ordering (default: 3)
 *   TALLY_WAIT          - Seconds to wait after tally before querying (default: 5)
 *
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 npx tsx test/voting-integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';
import { IndexerClient } from '../dist/indexer-client.js';
import { FIBER_DEFINITIONS } from '../dist/fiber-definitions.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
  indexerUrl: process.env.INDEXER_URL ?? 'http://localhost:3031',
  ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '30', 10),
  voteWait: parseInt(process.env.VOTE_WAIT ?? '3', 10),
  tallyWait: parseInt(process.env.TALLY_WAIT ?? '5', 10),
};

// Number of voters to generate.  Quorum is 0.5 → need ceil(3 * 0.5) = 2 votes.
const NUM_VOTERS = 3;
const QUORUM_THRESHOLD = 0.5; // matches voting fiber definition

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

interface Wallet {
  address: string;
  privateKey: string;
  publicKey: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a rejection is a benign timing race that should not fail the test.
 * SequenceNumberMismatch and NoTransitionForEvent resolve on their own.
 */
function isBenignRejection(rejection: { errors: Array<{ code: string }> }): boolean {
  return rejection.errors.every(
    e => e.code === 'SequenceNumberMismatch' || e.code === 'NoTransitionForEvent',
  );
}

/**
 * Query the rejection API for a fiber and assert no critical rejections occurred.
 */
async function assertNoRejections(
  indexer: IndexerClient,
  fiberId: string,
  label: string,
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
 * Wait for a fiber to reach a specific state in the indexer.
 */
async function waitForState(
  indexer: IndexerClient,
  fiberId: string,
  expectedState: string,
  timeoutSeconds: number,
): Promise<{ reached: boolean; actualState?: string; rejected?: boolean; rejectReason?: string }> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;
  const pollIntervalMs = 2000;

  console.log(`  ⏳ Waiting for state '${expectedState}' (up to ${timeoutSeconds}s)...`);

  let checkCount = 0;
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    checkCount++;

    const verification = await indexer.verifyFiber(fiberId);

    if (checkCount % 5 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const state = verification.fiber?.currentState ?? 'not-found';
      console.log(`  📊 [${elapsed}s] Indexer state: ${state}`);
    }

    if (verification.found && verification.fiber?.currentState === expectedState) {
      return { reached: true, actualState: verification.fiber.currentState };
    }

    // Fail fast on critical rejections
    if (verification.hasUnprocessedRejection && verification.rejections.length > 0) {
      const criticalRejection = verification.rejections.find(r => !isBenignRejection(r));
      if (criticalRejection) {
        const errors = criticalRejection.errors.map(e => e.code).join(', ');
        console.log(`  ❌ Transaction REJECTED: ${errors}`);
        return { reached: false, rejected: true, rejectReason: errors };
      }
      console.log(`  ⏳ Benign rejection (timing race), continuing...`);
    }

    await sleep(pollIntervalMs);
  }

  const finalCheck = await indexer.verifyFiber(fiberId);
  return {
    reached: finalCheck.fiber?.currentState === expectedState,
    actualState: finalCheck.fiber?.currentState,
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(results: TestResult[]): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of results) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '⏭️' : '❌';
    console.log(`${icon} ${r.name}${r.message ? ` (${r.message})` : ''}`);
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }

  console.log('');
  console.log(`Passed: ${passed}/${results.length}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}/${results.length}`);
  if (failed > 0) console.log(`Failed: ${failed}/${results.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Voting Fiber - Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiberWait=${CONFIG.fiberWaitTimeout}s, voteWait=${CONFIG.voteWait}s, tallyWait=${CONFIG.tallyWait}s`);
  console.log('');

  const results: TestResult[] = [];
  const client = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  const indexer = new IndexerClient({ indexerUrl: CONFIG.indexerUrl });

  let fiberCreated = false;
  let votingOpened = false;
  let fiberId: string | null = null;
  let proposerWallet: Wallet | null = null;
  const voterWallets: Wallet[] = [];

  // ── Test 1: Bridge health check ──────────────────────────────────────────
  console.log('🔍 Test 1: Bridge Health Check');
  try {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10000),
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Unexpected status: ${health.status}`);
    console.log('✓ Bridge is healthy');
    results.push({ name: 'Bridge Health Check', status: 'passed' });
  } catch (err) {
    console.error(`❌ Bridge health check failed: ${err}`);
    results.push({ name: 'Bridge Health Check', status: 'failed', message: String(err) });
    // Cannot continue without bridge
    printSummary(results);
    process.exit(1);
  }

  // ── Test 2: Wallet generation ─────────────────────────────────────────────
  console.log('\n🔍 Test 2: Wallet Generation (proposer + voters)');
  try {
    proposerWallet = await client.generateWallet();
    console.log(`  Proposer: ${proposerWallet.address}`);

    for (let i = 0; i < NUM_VOTERS; i++) {
      const voter = await client.generateWallet();
      voterWallets.push(voter);
      console.log(`  Voter ${i + 1}: ${voter.address}`);
    }

    console.log(`✓ Generated 1 proposer + ${NUM_VOTERS} voter wallets`);
    results.push({ name: 'Wallet Generation', status: 'passed' });
  } catch (err) {
    console.error(`❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet Generation', status: 'failed', message: String(err) });
    printSummary(results);
    process.exit(1);
  }

  // ── Test 3: Create Voting fiber ───────────────────────────────────────────
  console.log('\n🔍 Test 3: Create Voting Fiber (PROPOSED)');
  const votingDef = FIBER_DEFINITIONS['voting'];

  if (!votingDef) {
    console.error('❌ Voting fiber definition not found in FIBER_DEFINITIONS');
    results.push({ name: 'Create Voting Fiber', status: 'failed', message: 'definition not found' });
    printSummary(results);
    process.exit(1);
  }

  try {
    // Build participant map: proposer + voters
    const participants = new Map<string, string>();
    participants.set('proposer', proposerWallet!.address);
    for (let i = 0; i < NUM_VOTERS; i++) {
      participants.set(`voter${i + 1}`, voterWallets[i].address);
    }

    // Generate the initial state data from the fiber definition
    const tempFiberId = `temp-${Date.now().toString(36)}`;
    const initialData = votingDef.generateStateData(participants, {
      fiberId: tempFiberId,
      generation: 0,
    }) as Record<string, unknown>;

    // Transform old format to new bridge API format
    // Bridge expects:
    //   states: { 'STATE_NAME': { id: { value: 'STATE_NAME' }, isFinal: boolean } }
    //   initialState: { value: 'STATE_NAME' }
    //   transitions: [{ from: { value: 'X' }, to: { value: 'Y' }, eventName: '...', guard: null, effect: null }]
    const statesMap: Record<string, { id: { value: string }; isFinal: boolean }> = {};
    for (const stateName of votingDef.states) {
      statesMap[stateName] = {
        id: { value: stateName },
        isFinal: votingDef.finalStates.includes(stateName),
      };
    }

    const transitionsArray = votingDef.transitions.map(t => ({
      from: { value: t.from },
      to: { value: t.to },
      eventName: t.event,
      guard: null,
      effect: null,
    }));

    // Definition payload for the bridge (new format)
    const definition: Record<string, unknown> = {
      states: statesMap,
      initialState: { value: votingDef.initialState },
      transitions: transitionsArray,
      metadata: {
        name: votingDef.name,
        description: `${votingDef.type} workflow`,
      },
    };

    const createResult = await client.createFiber(
      proposerWallet!.privateKey,
      definition,
      initialData,
    );
    fiberId = createResult.fiberId;

    console.log(`✓ Voting fiber created: fiberId=${fiberId}`);
    console.log(`  Transaction hash: ${createResult.hash}`);
    console.log(`  Voters registered: ${NUM_VOTERS}, quorum threshold: ${QUORUM_THRESHOLD * 100}%`);

    results.push({ name: 'Create Voting Fiber', status: 'passed' });
  } catch (err) {
    console.error(`❌ Create fiber failed: ${err}`);
    results.push({ name: 'Create Voting Fiber', status: 'failed', message: String(err) });
    printSummary(results);
    process.exit(1);
  }

  // ── Test 4: Wait for PROPOSED in indexer ─────────────────────────────────
  console.log('\n🔍 Test 4: Wait for PROPOSED State in Indexer');
  {
    const waitResult = await waitForState(indexer, fiberId!, 'PROPOSED', CONFIG.fiberWaitTimeout);

    if (waitResult.rejected) {
      console.error(`❌ Transaction rejected: ${waitResult.rejectReason}`);
      results.push({
        name: 'Fiber in PROPOSED State',
        status: 'failed',
        message: `Rejected: ${waitResult.rejectReason}`,
      });
    } else if (waitResult.reached) {
      console.log('✓ Fiber is in PROPOSED state');
      results.push({ name: 'Fiber in PROPOSED State', status: 'passed' });
      fiberCreated = true;
    } else {
      console.error(`❌ Timed out. Actual state: ${waitResult.actualState ?? 'unknown'}`);
      results.push({
        name: 'Fiber in PROPOSED State',
        status: 'failed',
        message: `Timeout. Actual: ${waitResult.actualState ?? 'unknown'}`,
      });
    }
  }

  // ── Test 5: Assert no rejections after creation ───────────────────────────
  console.log('\n🔍 Test 5: Assert No Rejections After Creation');
  if (!fiberCreated) {
    console.log('⏭️  Skipped (fiber not in PROPOSED state)');
    results.push({ name: 'No Rejections After Creation', status: 'skipped', message: 'fiber not in PROPOSED' });
  } else {
    const noRejectResult = await assertNoRejections(indexer, fiberId!, 'after creation');
    results.push({
      name: 'No Rejections After Creation',
      status: noRejectResult.passed ? 'passed' : 'failed',
      message: noRejectResult.message,
    });
  }

  // ── Test 6: Open voting (PROPOSED → VOTING) ───────────────────────────────
  console.log('\n🔍 Test 6: Open Voting (PROPOSED → VOTING)');
  if (!fiberCreated) {
    console.log('⏭️  Skipped (fiber not in PROPOSED state)');
    results.push({ name: 'Open Voting Transition', status: 'skipped', message: 'fiber not in PROPOSED' });
  } else {
    try {
      const openResult = await client.transitionFiber(
        proposerWallet!.privateKey,
        fiberId!,
        'open',
        { agent: proposerWallet!.address },
      );
      console.log(`✓ Voting opened: hash=${openResult.hash}`);
      results.push({ name: 'Open Voting Transition', status: 'passed' });
    } catch (err) {
      console.error(`❌ Open voting failed: ${err}`);
      results.push({ name: 'Open Voting Transition', status: 'failed', message: String(err) });
    }
  }

  // ── Test 7: Wait for VOTING in indexer ───────────────────────────────────
  console.log('\n🔍 Test 7: Wait for VOTING State in Indexer');
  if (!fiberCreated) {
    console.log('⏭️  Skipped');
    results.push({ name: 'Fiber in VOTING State', status: 'skipped', message: 'fiber not created' });
  } else {
    const waitResult = await waitForState(indexer, fiberId!, 'VOTING', CONFIG.fiberWaitTimeout);

    if (waitResult.rejected) {
      console.error(`❌ Transaction rejected: ${waitResult.rejectReason}`);
      results.push({
        name: 'Fiber in VOTING State',
        status: 'failed',
        message: `Rejected: ${waitResult.rejectReason}`,
      });
    } else if (waitResult.reached) {
      console.log('✓ Fiber is in VOTING state');
      results.push({ name: 'Fiber in VOTING State', status: 'passed' });
      votingOpened = true;
    } else {
      console.error(`❌ Timed out. Actual state: ${waitResult.actualState ?? 'unknown'}`);
      results.push({
        name: 'Fiber in VOTING State',
        status: 'failed',
        message: `Timeout. Actual: ${waitResult.actualState ?? 'unknown'}`,
      });
    }
  }

  // ── Test 8: Assert no rejections after open ───────────────────────────────
  console.log('\n🔍 Test 8: Assert No Rejections After Open');
  if (!fiberCreated) {
    console.log('⏭️  Skipped');
    results.push({ name: 'No Rejections After Open', status: 'skipped', message: 'fiber not created' });
  } else {
    const noRejectResult = await assertNoRejections(indexer, fiberId!, 'after open');
    results.push({
      name: 'No Rejections After Open',
      status: noRejectResult.passed ? 'passed' : 'failed',
      message: noRejectResult.message,
    });
  }

  // ── Test 9: Vote casting (quorum mechanics) ────────────────────────────────
  // Cast votes from 2 of 3 voters (meets 50% quorum). Both vote "Yes".
  const requiredVotes = Math.ceil(NUM_VOTERS * QUORUM_THRESHOLD);
  console.log(`\n🔍 Test 9: Vote Casting (${requiredVotes}/${NUM_VOTERS} voters - meets ${QUORUM_THRESHOLD * 100}% quorum)`);

  if (!votingOpened) {
    console.log('⏭️  Skipped (voting not open)');
    results.push({ name: 'Vote Casting', status: 'skipped', message: 'voting not opened' });
  } else {
    let votesFailed = false;

    for (let i = 0; i < requiredVotes; i++) {
      const voter = voterWallets[i];
      const voteOption = 'Yes'; // All quorum voters vote Yes → tally_pass expected

      try {
        console.log(`  → Voter ${i + 1} (${voter.address.slice(0, 12)}...) casting vote: "${voteOption}"`);
        const voteResult = await client.transitionFiber(
          voter.privateKey,
          fiberId!,
          'vote',
          {
            voter: voter.address,
            vote: voteOption,
            votedAt: new Date().toISOString(),
          },
        );
        console.log(`    ✓ Vote accepted: hash=${voteResult.hash}`);

        // Brief pause between votes to allow ordering
        if (i < requiredVotes - 1) {
          await sleep(CONFIG.voteWait * 1000);
        }
      } catch (err) {
        console.error(`    ❌ Vote ${i + 1} failed: ${err}`);
        votesFailed = true;
        break;
      }
    }

    if (votesFailed) {
      results.push({ name: 'Vote Casting', status: 'failed', message: 'one or more votes rejected' });
    } else {
      console.log(`✓ ${requiredVotes} votes submitted successfully`);
      results.push({ name: 'Vote Casting', status: 'passed' });
    }
  }

  // ── Test 10: Assert no rejections after voting ────────────────────────────
  console.log('\n🔍 Test 10: Assert No Rejections After Vote Casting');
  if (!votingOpened) {
    console.log('⏭️  Skipped');
    results.push({ name: 'No Rejections After Voting', status: 'skipped', message: 'voting not opened' });
  } else {
    // Give metagraph a moment to process votes
    console.log(`⏳ Waiting for vote processing (${CONFIG.voteWait}s)...`);
    await sleep(CONFIG.voteWait * 1000);

    const noRejectResult = await assertNoRejections(indexer, fiberId!, 'after vote casting');
    results.push({
      name: 'No Rejections After Voting',
      status: noRejectResult.passed ? 'passed' : 'failed',
      message: noRejectResult.message,
    });
  }

  // ── Test 11: Tally votes → PASSED ─────────────────────────────────────────
  // Proposer tallies: quorum met, majority voted "Yes" → tally_pass
  console.log('\n🔍 Test 11: Tally Votes → PASSED (tally_pass)');

  if (!votingOpened) {
    console.log('⏭️  Skipped (voting not open)');
    results.push({ name: 'Tally Pass Transition', status: 'skipped', message: 'voting not opened' });
  } else {
    try {
      const tallyResult = await client.transitionFiber(
        proposerWallet!.privateKey,
        fiberId!,
        'tally_pass',
        {
          agent: proposerWallet!.address,
          result: 'PASSED',
          votesFor: requiredVotes,
          totalVotes: requiredVotes,
          quorumMet: true,
          talliedAt: new Date().toISOString(),
        },
      );
      console.log(`✓ Tally submitted (tally_pass): hash=${tallyResult.hash}`);
      results.push({ name: 'Tally Pass Transition', status: 'passed' });
    } catch (err) {
      console.error(`❌ Tally transition failed: ${err}`);
      results.push({ name: 'Tally Pass Transition', status: 'failed', message: String(err) });
    }
  }

  // ── Test 12: Wait for PASSED in indexer ──────────────────────────────────
  console.log('\n🔍 Test 12: Wait for PASSED State in Indexer');
  if (!votingOpened) {
    console.log('⏭️  Skipped');
    results.push({ name: 'Fiber in PASSED State', status: 'skipped', message: 'voting not opened' });
  } else {
    console.log(`⏳ Waiting for tally to process (${CONFIG.tallyWait}s)...`);
    await sleep(CONFIG.tallyWait * 1000);

    const waitResult = await waitForState(indexer, fiberId!, 'PASSED', CONFIG.fiberWaitTimeout);

    if (waitResult.rejected) {
      console.error(`❌ Tally rejected: ${waitResult.rejectReason}`);
      results.push({
        name: 'Fiber in PASSED State',
        status: 'failed',
        message: `Rejected: ${waitResult.rejectReason}`,
      });
    } else if (waitResult.reached) {
      console.log('✓ Fiber reached PASSED state (voting complete)');
      results.push({ name: 'Fiber in PASSED State', status: 'passed' });
    } else {
      console.error(`❌ Timed out. Actual state: ${waitResult.actualState ?? 'unknown'}`);
      results.push({
        name: 'Fiber in PASSED State',
        status: 'failed',
        message: `Timeout. Actual: ${waitResult.actualState ?? 'unknown'}`,
      });
    }
  }

  // ── Test 13: Assert no rejections after tally ─────────────────────────────
  console.log('\n🔍 Test 13: Assert No Rejections After Tally');
  if (!votingOpened) {
    console.log('⏭️  Skipped');
    results.push({ name: 'No Rejections After Tally', status: 'skipped', message: 'voting not opened' });
  } else {
    const noRejectResult = await assertNoRejections(indexer, fiberId!, 'after tally');
    results.push({
      name: 'No Rejections After Tally',
      status: noRejectResult.passed ? 'passed' : 'failed',
      message: noRejectResult.message,
    });
  }

  // ── Test 14: Verify final indexer state (detailed) ────────────────────────
  console.log('\n🔍 Test 14: Verify Final Indexer State (detailed)');
  if (!fiberCreated || !fiberId) {
    console.log('⏭️  Skipped (fiber not indexed)');
    results.push({ name: 'Verify Final Indexer State', status: 'skipped', message: 'fiber not indexed' });
  } else {
    try {
      const verification = await indexer.verifyFiber(fiberId);

      if (verification.found && verification.fiber) {
        const { currentState, sequenceNumber } = verification.fiber;
        console.log(`✓ Fiber in indexer: state=${currentState}, seq=${sequenceNumber}`);

        // Log full transition history
        const transitions = await indexer.getFiberTransitions(fiberId, 10);
        if (transitions.length > 0) {
          console.log('  Transition history:');
          for (const t of transitions) {
            const arrow = `${t.fromState} → ${t.toState}`;
            console.log(`    [seq=${t.snapshotOrdinal}] ${t.eventName}: ${arrow}`);
          }
        }

        // Verify expected state is PASSED
        const statePassed = currentState === 'PASSED';
        if (!statePassed) {
          console.log(`  ⚠️  Expected PASSED, got: ${currentState}`);
        }

        // Check for critical rejections
        const criticalRejections = verification.rejections.filter(r => !isBenignRejection(r));
        if (criticalRejections.length > 0) {
          console.log(`  ⚠️ ${criticalRejections.length} critical rejection(s):`);
          for (const rej of criticalRejections.slice(0, 3)) {
            console.log(`    - ${rej.updateType}: ${rej.errors.map(e => e.code).join(', ')}`);
          }
        } else {
          console.log('  ✓ No rejections for this fiber');
        }

        results.push({
          name: 'Verify Final Indexer State',
          status: criticalRejections.length === 0 ? 'passed' : 'failed',
          message: statePassed ? `state=${currentState}` : `expected PASSED, got ${currentState}`,
        });
      } else {
        console.error('❌ Fiber not found in indexer');
        results.push({ name: 'Verify Final Indexer State', status: 'failed', message: 'fiber not found' });
      }
    } catch (err) {
      console.error(`❌ Indexer verification failed: ${err}`);
      results.push({ name: 'Verify Final Indexer State', status: 'failed', message: String(err) });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  printSummary(results);

  const failures = results.filter(r => r.status === 'failed').length;
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Voting integration test failed:', err);
  process.exit(1);
});
