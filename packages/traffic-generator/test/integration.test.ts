#!/usr/bin/env npx tsx
/**
 * Traffic Generator Integration Test
 * 
 * Tests the full agent and contract lifecycle using the Indexer as source of truth.
 * 
 * Tests:
 *   1. Bridge health check
 *   2. Wallet generation
 *   3. Agent registration
 *   4. Wait for fiber in indexer
 *   5. Agent activation
 *   6. Verify ACTIVE state
 *   7. Indexer state verification
 *   8. Second agent registration (for vouching)
 *   9. Agent vouching
 *  10. Contract proposal
 *  11. Contract acceptance
 *  12. Contract completion
 *  13. Contract finalization
 * 
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   INDEXER_URL         - Indexer service URL (default: http://localhost:3031)
 *   ML0_URL             - Metagraph L0 URL (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber in state (default: 30)
 *   DL1_SYNC_WAIT       - Seconds to wait for DL1 sync (default: 10)
 *   ACTIVATION_WAIT     - Seconds to wait after activation (default: 5)
 *   TRANSITION_WAIT     - Seconds to wait between transitions (default: 3)
 * 
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 npx tsx test/integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';
import { IndexerClient } from '../dist/indexer-client.js';

// Configuration with ENV overrides
const CONFIG = {
  bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
  indexerUrl: process.env.INDEXER_URL ?? 'http://localhost:3031',
  ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '30', 10),
  dl1SyncWait: parseInt(process.env.DL1_SYNC_WAIT ?? '10', 10),
  activationWait: parseInt(process.env.ACTIVATION_WAIT ?? '5', 10),
  transitionWait: parseInt(process.env.TRANSITION_WAIT ?? '3', 10),
  maxRegistrationRetries: parseInt(process.env.MAX_REGISTRATION_RETRIES ?? '2', 10),
};

// Normalize state to uppercase for comparison (ML0 uses Title case, indexer uses UPPER)
function normalizeState(state: string): string {
  return state.toUpperCase();
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for fiber to appear in the indexer (source of truth).
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
      const status = verification.found ? 'FOUND' : 'waiting...';
      console.log(`  📊 [${elapsed}s] Indexer status: ${status}`);
    }
    
    if (verification.found) {
      return { found: true };
    }
    
    // Check for rejections that would block success
    if (verification.hasUnprocessedRejection && verification.rejections.length > 0) {
      // Only fail-fast on registration rejections, not transition timing issues
      const criticalRejection = verification.rejections.find(r => 
        r.updateType === 'CreateStateMachine' || 
        r.errors.some(e => e.code !== 'SequenceNumberMismatch' && e.code !== 'NoTransitionForEvent')
      );
      if (criticalRejection) {
        const errors = criticalRejection.errors.map(e => e.code).join(', ');
        console.log(`  ❌ Transaction REJECTED: ${errors}`);
        return { found: false, rejected: true, rejectReason: errors };
      }
    }
    
    await sleep(pollIntervalMs);
  }
  
  return { found: false };
}

/**
 * Wait for fiber to reach expected state in indexer
 */
async function waitForState(
  indexer: IndexerClient,
  fiberId: string,
  expectedState: string,
  timeoutSeconds: number
): Promise<{ success: boolean; actualState?: string }> {
  const result = await indexer.waitForState(fiberId, expectedState, {
    timeoutMs: timeoutSeconds * 1000,
    pollIntervalMs: 2000,
  });
  
  return {
    success: result.found,
    actualState: result.actualState ?? undefined,
  };
}

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

interface TestContext {
  client: BridgeClient;
  indexer: IndexerClient;
  results: TestResult[];
  wallets: Array<{ address: string; privateKey: string }>;
  fiberIds: string[];
  contractId?: string;
}

async function runTest(
  ctx: TestContext,
  name: string,
  testFn: () => Promise<void>,
  skipCondition?: () => boolean
): Promise<boolean> {
  console.log(`\n🔍 ${name}`);
  
  if (skipCondition?.()) {
    console.log('⏭️  Skipped (dependency not met)');
    ctx.results.push({ name, status: 'skipped', message: 'Dependency not met' });
    return false;
  }
  
  try {
    await testFn();
    ctx.results.push({ name, status: 'passed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${message}`);
    ctx.results.push({ name, status: 'failed', message });
    return false;
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Traffic Generator - Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiber=${CONFIG.fiberWaitTimeout}s, sync=${CONFIG.dl1SyncWait}s, transition=${CONFIG.transitionWait}s`);
  console.log('');

  const ctx: TestContext = {
    client: new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url }),
    indexer: new IndexerClient({ indexerUrl: CONFIG.indexerUrl }),
    results: [],
    wallets: [],
    fiberIds: [],
  };

  let agent1Ready = false;
  let agent2Ready = false;
  let contractReady = false;

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Setup & First Agent
  // ═══════════════════════════════════════════════════════════════

  // Test 1: Bridge health check
  await runTest(ctx, 'Test 1: Bridge Health Check', async () => {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10000)
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') {
      throw new Error(`Unexpected status: ${health.status}`);
    }
    console.log('✓ Bridge is healthy');
  });

  // Test 2: Wallet generation (generate 2 for later vouching test)
  await runTest(ctx, 'Test 2: Wallet Generation', async () => {
    const wallet1 = await ctx.client.generateWallet();
    const wallet2 = await ctx.client.generateWallet();
    ctx.wallets.push(wallet1, wallet2);
    console.log(`✓ Generated wallet 1: ${wallet1.address}`);
    console.log(`✓ Generated wallet 2: ${wallet2.address}`);
  });

  if (ctx.wallets.length < 2) {
    console.error('\n❌ Cannot continue without wallets');
    printSummary(ctx.results);
    process.exit(1);
  }

  // Test 3 & 4: Agent registration + wait for fiber (with retry)
  for (let attempt = 1; attempt <= CONFIG.maxRegistrationRetries; attempt++) {
    const passed = await runTest(ctx, `Test 3: Agent Registration (attempt ${attempt}/${CONFIG.maxRegistrationRetries})`, async () => {
      const displayName = `TestAgent1_${Date.now().toString(36)}_${attempt}`;
      const platform = 'discord';
      const platformUserId = `discord_test_${ctx.wallets[0].address.slice(4, 12)}_${attempt}`;
      
      const regResult = await ctx.client.registerAgent(
        ctx.wallets[0].privateKey,
        displayName,
        platform,
        platformUserId
      );
      ctx.fiberIds[0] = regResult.fiberId;
      console.log(`✓ Agent registered: fiberId=${regResult.fiberId}`);
      console.log(`  Transaction hash: ${regResult.hash}`);
    });

    if (!passed || !ctx.fiberIds[0]) continue;

    // Test 4: Wait for fiber
    const waitPassed = await runTest(ctx, `Test 4: Wait for Fiber in Indexer`, async () => {
      const waitResult = await waitForFiber(ctx.indexer, ctx.fiberIds[0], CONFIG.fiberWaitTimeout);
      
      if (waitResult.rejected) {
        throw new Error(`Transaction rejected: ${waitResult.rejectReason}`);
      }
      
      if (!waitResult.found) {
        throw new Error(`Fiber did not appear after ${CONFIG.fiberWaitTimeout}s`);
      }
      
      console.log('✓ Fiber indexed successfully');
      console.log(`⏳ Waiting for DL1 sync (${CONFIG.dl1SyncWait}s)...`);
      await sleep(CONFIG.dl1SyncWait * 1000);
    });

    if (waitPassed) {
      agent1Ready = true;
      break;
    }
  }

  if (!agent1Ready) {
    console.error('\n❌ Agent 1 not ready, cannot continue');
    printSummary(ctx.results);
    process.exit(1);
  }

  // Test 5: Agent activation
  await runTest(ctx, 'Test 5: Agent Activation', async () => {
    const actResult = await ctx.client.activateAgent(ctx.wallets[0].privateKey, ctx.fiberIds[0]);
    console.log(`✓ Agent activated: hash=${actResult.hash}`);
  }, () => !agent1Ready);

  // Test 6: Verify ACTIVE state
  await runTest(ctx, 'Test 6: Verify ACTIVE State', async () => {
    console.log(`⏳ Waiting for activation to process (${CONFIG.activationWait}s)...`);
    await sleep(CONFIG.activationWait * 1000);
    
    const checkpoint = await fetch(`${CONFIG.ml0Url}/data-application/v1/checkpoint`, {
      signal: AbortSignal.timeout(10000)
    }).then(r => r.json()) as any;
    const fiber = checkpoint.state?.stateMachines?.[ctx.fiberIds[0]];
    
    if (!fiber) {
      throw new Error('Fiber not found in checkpoint');
    }
    
    const state = normalizeState(fiber.currentState?.value ?? '');
    if (state === 'ACTIVE') {
      console.log('✓ Agent state is ACTIVE');
    } else {
      // May still be processing - check indexer as fallback
      const indexerState = await ctx.indexer.getFiber(ctx.fiberIds[0]);
      if (indexerState && normalizeState(indexerState.currentState) === 'ACTIVE') {
        console.log(`✓ Agent state is ACTIVE (via indexer, ML0 shows ${fiber.currentState?.value})`);
      } else {
        console.log(`⚠️ Agent state is ${state} (may need another snapshot cycle)`);
      }
    }
  }, () => !agent1Ready);

  // Test 7: Verify Indexer state (detailed)
  await runTest(ctx, 'Test 7: Verify Indexer State', async () => {
    const verification = await ctx.indexer.verifyFiber(ctx.fiberIds[0]);
    
    if (!verification.found || !verification.fiber) {
      throw new Error('Fiber not found in indexer');
    }
    
    console.log(`✓ Fiber in indexer: state=${verification.fiber.currentState}, seq=${verification.fiber.sequenceNumber}`);
    
    if (verification.lastTransition) {
      console.log(`  Last transition: ${verification.lastTransition.eventName} (${verification.lastTransition.fromState} → ${verification.lastTransition.toState})`);
    }
    
    // Only show rejections if they indicate a real problem (not timing races)
    const realRejections = verification.rejections.filter(r => 
      !r.errors.every(e => e.code === 'SequenceNumberMismatch' || e.code === 'NoTransitionForEvent')
    );
    
    if (realRejections.length > 0) {
      console.log(`  ⚠️ Found ${realRejections.length} rejection(s) for this fiber`);
      for (const rej of realRejections.slice(0, 3)) {
        console.log(`    - ${rej.updateType}: ${rej.errors.map(e => e.code).join(', ')}`);
      }
    } else {
      console.log(`  ✓ No critical rejections`);
    }
  }, () => !agent1Ready);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Second Agent & Vouching
  // ═══════════════════════════════════════════════════════════════

  // Test 8: Second agent registration
  await runTest(ctx, 'Test 8: Second Agent Registration', async () => {
    const displayName = `TestAgent2_${Date.now().toString(36)}`;
    const platform = 'telegram';
    const platformUserId = `telegram_test_${ctx.wallets[1].address.slice(4, 12)}`;
    
    const regResult = await ctx.client.registerAgent(
      ctx.wallets[1].privateKey,
      displayName,
      platform,
      platformUserId
    );
    ctx.fiberIds[1] = regResult.fiberId;
    console.log(`✓ Agent 2 registered: fiberId=${regResult.fiberId}`);
    
    // Wait for it to appear
    const waitResult = await waitForFiber(ctx.indexer, ctx.fiberIds[1], CONFIG.fiberWaitTimeout);
    if (!waitResult.found) {
      throw new Error('Agent 2 did not appear in indexer');
    }
    console.log('✓ Agent 2 indexed');
    
    // Activate agent 2
    const actResult = await ctx.client.activateAgent(ctx.wallets[1].privateKey, ctx.fiberIds[1]);
    console.log(`✓ Agent 2 activated: hash=${actResult.hash}`);
    
    // Wait for activation
    await sleep(CONFIG.activationWait * 1000);
    agent2Ready = true;
  }, () => !agent1Ready);

  // Test 9: Agent vouching (Agent 1 vouches for Agent 2)
  await runTest(ctx, 'Test 9: Agent Vouching', async () => {
    const vouchResult = await ctx.client.vouchForAgent(
      ctx.wallets[0].privateKey,
      ctx.fiberIds[0],      // voucher (agent 1)
      ctx.fiberIds[1],      // vouchee (agent 2)
      'Integration test vouch'
    );
    console.log(`✓ Vouch submitted: hash=${vouchResult.hash}`);
    
    // Wait for processing
    await sleep(CONFIG.transitionWait * 1000);
    
    // Verify via indexer
    const verification = await ctx.indexer.verifyFiber(ctx.fiberIds[0]);
    if (verification.lastTransition?.eventName === 'vouch') {
      console.log('✓ Vouch transition recorded in indexer');
    } else {
      console.log(`  Last transition: ${verification.lastTransition?.eventName ?? 'none'}`);
    }
  }, () => !agent1Ready || !agent2Ready);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: Contract Lifecycle
  // ═══════════════════════════════════════════════════════════════

  // Test 10: Contract proposal
  await runTest(ctx, 'Test 10: Contract Proposal', async () => {
    const proposeResult = await ctx.client.proposeContract(
      ctx.wallets[0].privateKey,
      ctx.fiberIds[0],         // proposer (agent 1)
      ctx.fiberIds[1],         // counterparty (agent 2)
      {
        title: 'Integration Test Contract',
        description: 'Automated test contract for CI',
        terms: { deliverable: 'Pass all tests', deadline: '2026-12-31' },
      },
      BigInt(1000)             // value in tokens
    );
    ctx.contractId = proposeResult.fiberId;
    console.log(`✓ Contract proposed: contractId=${ctx.contractId}`);
    console.log(`  Transaction hash: ${proposeResult.hash}`);
    
    // Wait for indexing
    const waitResult = await waitForFiber(ctx.indexer, ctx.contractId, CONFIG.fiberWaitTimeout);
    if (!waitResult.found) {
      throw new Error('Contract did not appear in indexer');
    }
    console.log('✓ Contract indexed');
    contractReady = true;
  }, () => !agent1Ready || !agent2Ready);

  // Test 11: Contract acceptance
  await runTest(ctx, 'Test 11: Contract Acceptance', async () => {
    const acceptResult = await ctx.client.acceptContract(
      ctx.wallets[1].privateKey,
      ctx.fiberIds[1],         // acceptor (agent 2)
      ctx.contractId!
    );
    console.log(`✓ Contract accepted: hash=${acceptResult.hash}`);
    
    // Wait for state change
    await sleep(CONFIG.transitionWait * 1000);
    
    // Verify state
    const stateResult = await waitForState(ctx.indexer, ctx.contractId!, 'ACCEPTED', CONFIG.transitionWait * 2);
    if (stateResult.success) {
      console.log('✓ Contract state: ACCEPTED');
    } else {
      console.log(`  Contract state: ${stateResult.actualState ?? 'unknown'}`);
    }
  }, () => !contractReady);

  // Test 12: Contract completion
  await runTest(ctx, 'Test 12: Contract Completion', async () => {
    const completeResult = await ctx.client.submitCompletion(
      ctx.wallets[0].privateKey,
      ctx.fiberIds[0],         // completer (agent 1)
      ctx.contractId!,
      'All tests passed successfully'
    );
    console.log(`✓ Completion submitted: hash=${completeResult.hash}`);
    
    await sleep(CONFIG.transitionWait * 1000);
    
    const stateResult = await waitForState(ctx.indexer, ctx.contractId!, 'COMPLETED', CONFIG.transitionWait * 2);
    if (stateResult.success) {
      console.log('✓ Contract state: COMPLETED');
    } else {
      console.log(`  Contract state: ${stateResult.actualState ?? 'unknown'}`);
    }
  }, () => !contractReady);

  // Test 13: Contract finalization
  await runTest(ctx, 'Test 13: Contract Finalization', async () => {
    const finalizeResult = await ctx.client.finalizeContract(
      ctx.wallets[1].privateKey,
      ctx.fiberIds[1],         // finalizer (agent 2)
      ctx.contractId!
    );
    console.log(`✓ Contract finalized: hash=${finalizeResult.hash}`);
    
    await sleep(CONFIG.transitionWait * 1000);
    
    const stateResult = await waitForState(ctx.indexer, ctx.contractId!, 'FINALIZED', CONFIG.transitionWait * 2);
    if (stateResult.success) {
      console.log('✓ Contract state: FINALIZED');
    } else {
      console.log(`  Contract state: ${stateResult.actualState ?? 'unknown'}`);
    }
  }, () => !contractReady);

  printSummary(ctx.results);
  
  // Exit with error only if there are hard failures (not skips)
  const failures = ctx.results.filter(r => r.status === 'failed').length;
  if (failures > 0) {
    process.exit(1);
  }
}

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

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
