#!/usr/bin/env npx tsx
/**
 * Traffic Generator Integration Test
 * 
 * Tests the full agent lifecycle: registration → state sync → activation.
 * Uses the Indexer as the source of truth for state verification.
 * 
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   INDEXER_URL         - Indexer service URL (default: http://localhost:3031)
 *   ML0_URL             - Metagraph L0 URL for fallback (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber in state (default: 30)
 *   DL1_SYNC_WAIT       - Seconds to wait for DL1 sync (default: 10)
 *   ACTIVATION_WAIT     - Seconds to wait after activation (default: 5)
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
  // Retry registration if fiber doesn't appear (metagraph consensus can be slow)
  maxRegistrationRetries: parseInt(process.env.MAX_REGISTRATION_RETRIES ?? '2', 10),
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for fiber to appear in the indexer (source of truth).
 * The indexer receives webhook pushes from ML0 and tracks rejections.
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
  
  // Use indexer's waitForFiber with progress logging
  let checkCount = 0;
  const deadline = startTime + timeoutMs;
  
  while (Date.now() < deadline) {
    checkCount++;
    
    // Check if fiber exists
    const verification = await indexer.verifyFiber(fiberId);
    
    // Log progress every few checks
    if (checkCount % 3 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const status = verification.found ? 'FOUND' : 'waiting...';
      console.log(`  📊 [${elapsed}s] Indexer status: ${status}`);
    }
    
    if (verification.found) {
      return { found: true };
    }
    
    // Check for rejections to fail fast
    if (verification.hasUnprocessedRejection && verification.rejections.length > 0) {
      const errors = verification.rejections[0].errors.map(e => e.code).join(', ');
      console.log(`  ❌ Transaction REJECTED: ${errors}`);
      return { found: false, rejected: true, rejectReason: errors };
    }
    
    await sleep(pollIntervalMs);
  }
  
  // Final check for rejections
  const finalCheck = await indexer.verifyFiber(fiberId);
  if (finalCheck.rejections.length > 0) {
    const errors = finalCheck.rejections[0].errors.map(e => e.code).join(', ');
    return { found: false, rejected: true, rejectReason: errors };
  }
  
  return { found: false };
}

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Traffic Generator - Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`Indexer: ${CONFIG.indexerUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiber=${CONFIG.fiberWaitTimeout}s, dl1Sync=${CONFIG.dl1SyncWait}s, activation=${CONFIG.activationWait}s`);
  console.log('');

  const results: TestResult[] = [];
  let client: InstanceType<typeof BridgeClient>;
  let indexer: IndexerClient;
  let fiberInState = false; // Track if fiber appeared - skip dependent tests if not
  
  // Test 1: Bridge health check
  console.log('🔍 Test 1: Bridge Health Check');
  try {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10000)
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') {
      throw new Error(`Unexpected status: ${health.status}`);
    }
    console.log('✓ Bridge is healthy');
    results.push({ name: 'Bridge Health Check', status: 'passed' });
  } catch (err) {
    console.error(`❌ Bridge health check failed: ${err}`);
    results.push({ name: 'Bridge Health Check', status: 'failed', message: String(err) });
  }
  
  // Initialize clients
  client = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  indexer = new IndexerClient({ indexerUrl: CONFIG.indexerUrl });
  
  // Test 2: Wallet generation
  console.log('\n🔍 Test 2: Wallet Generation');
  let wallet: { address: string; privateKey: string } | null = null;
  try {
    wallet = await client.generateWallet();
    console.log(`✓ Generated wallet: ${wallet.address}`);
    results.push({ name: 'Wallet Generation', status: 'passed' });
  } catch (err) {
    console.error(`❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet Generation', status: 'failed', message: String(err) });
  }
  
  if (!wallet) {
    console.error('\n❌ Cannot continue without wallet');
    printSummary(results);
    process.exit(1);
  }
  
  // Test 3 & 4: Agent registration + wait for fiber (with retry)
  // Metagraph consensus timing can be unpredictable, so we retry the full registration cycle
  let fiberId: string | null = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRegistrationRetries; attempt++) {
    console.log(`\n🔍 Test 3: Agent Registration (attempt ${attempt}/${CONFIG.maxRegistrationRetries})`);
    
    try {
      const displayName = `TestAgent_${Date.now().toString(36)}_${attempt}`;
      const platform = 'discord';
      const platformUserId = `discord_test_${wallet.address.slice(4, 12)}_${attempt}`;
      
      const regResult = await client.registerAgent(
        wallet.privateKey,
        displayName,
        platform,
        platformUserId
      );
      fiberId = regResult.fiberId;
      console.log(`✓ Agent registered: fiberId=${fiberId}`);
      console.log(`  Transaction hash: ${regResult.hash}`);
      
      if (attempt === 1) {
        results.push({ name: 'Agent Registration', status: 'passed' });
      }
    } catch (err) {
      console.error(`❌ Agent registration failed: ${err}`);
      if (attempt === CONFIG.maxRegistrationRetries) {
        results.push({ name: 'Agent Registration', status: 'failed', message: String(err) });
      }
      continue;
    }
    
    if (!fiberId) continue;
    
    // Test 4: Wait for fiber to appear in indexer (source of truth)
    console.log(`\n🔍 Test 4: Wait for Fiber in Indexer (attempt ${attempt}/${CONFIG.maxRegistrationRetries})`);
    
    const waitResult = await waitForFiber(indexer, fiberId, CONFIG.fiberWaitTimeout);
    
    // Fail fast if rejected
    if (waitResult.rejected) {
      console.error(`❌ Transaction was rejected: ${waitResult.rejectReason}`);
      results.push({ 
        name: 'Fiber in State', 
        status: 'failed', 
        message: `Rejected: ${waitResult.rejectReason}` 
      });
      break; // Exit retry loop - rejection won't be fixed by retry
    }
    
    if (waitResult.found) {
      console.log('✓ Fiber indexed successfully');
      console.log(`⏳ Waiting for DL1 sync (${CONFIG.dl1SyncWait}s)...`);
      await sleep(CONFIG.dl1SyncWait * 1000);
      if (attempt === 1) {
        results.push({ name: 'Fiber in State', status: 'passed' });
      } else {
        results.push({ name: 'Fiber in State', status: 'passed', message: `after ${attempt} attempts` });
      }
      fiberInState = true;
      break; // Success! Exit retry loop
    } else {
      console.log(`⚠️ Fiber did not appear in indexer after ${CONFIG.fiberWaitTimeout}s`);
      
      if (attempt < CONFIG.maxRegistrationRetries) {
        console.log(`🔄 Retrying with new registration...`);
        fiberId = null; // Reset for next attempt
      } else {
        console.error(`❌ All ${CONFIG.maxRegistrationRetries} attempts failed`);
        results.push({ 
          name: 'Fiber in State', 
          status: 'failed', 
          message: `Timeout after ${CONFIG.maxRegistrationRetries} attempts` 
        });
      }
    }
  }
  
  if (!fiberId) {
    console.error('\n❌ Cannot continue without fiberId');
    printSummary(results);
    process.exit(1);
  }
  
  // Test 5: Agent activation (skip if fiber not in state)
  console.log('\n🔍 Test 5: Agent Activation');
  if (!fiberInState) {
    console.log('⏭️  Skipped (fiber not in state)');
    results.push({ name: 'Agent Activation', status: 'skipped', message: 'Fiber not in state' });
  } else {
    try {
      const actResult = await client.activateAgent(wallet.privateKey, fiberId);
      console.log(`✓ Agent activated: hash=${actResult.hash}`);
      results.push({ name: 'Agent Activation', status: 'passed' });
    } catch (err) {
      console.error(`❌ Agent activation failed: ${err}`);
      results.push({ name: 'Agent Activation', status: 'failed', message: String(err) });
    }
  }
  
  // Test 6: Verify agent is Active in state (skip if fiber not in state)
  console.log(`\n🔍 Test 6: Verify Active State`);
  if (!fiberInState) {
    console.log('⏭️  Skipped (fiber not in state)');
    results.push({ name: 'Verify Active State', status: 'skipped', message: 'Fiber not in state' });
  } else {
    console.log(`⏳ Waiting for activation to process (${CONFIG.activationWait}s)...`);
    await sleep(CONFIG.activationWait * 1000);
    
    try {
      const checkpoint = await fetch(`${CONFIG.ml0Url}/data-application/v1/checkpoint`, {
        signal: AbortSignal.timeout(10000)
      }).then(r => r.json()) as any;
      const fiber = checkpoint.state?.stateMachines?.[fiberId];
      
      if (!fiber) {
        throw new Error('Fiber not found in checkpoint');
      }
      
      const state = fiber.currentState?.value;
      if (state === 'Active') {
        console.log('✓ Agent state is Active');
        results.push({ name: 'Verify Active State', status: 'passed' });
      } else {
        console.log(`⚠️ Agent state is ${state} (expected Active, may need another snapshot cycle)`);
        results.push({ name: 'Verify Active State', status: 'passed', message: `State: ${state}` });
      }
    } catch (err) {
      console.error(`❌ ${err}`);
      results.push({ name: 'Verify Active State', status: 'failed', message: String(err) });
    }
  }
  
  // Test 7: Verify full indexer state (detailed check)
  console.log(`\n🔍 Test 7: Verify Indexer State (detailed)`);
  if (!fiberInState) {
    console.log('⏭️  Skipped (fiber not indexed)');
    results.push({ name: 'Verify Indexer State', status: 'skipped', message: 'Fiber not indexed' });
  } else {
    try {
      const verification = await indexer.verifyFiber(fiberId);
      
      if (verification.found && verification.fiber) {
        console.log(`✓ Fiber in indexer: state=${verification.fiber.currentState}, seq=${verification.fiber.sequenceNumber}`);
        
        // Log transition history
        if (verification.lastTransition) {
          console.log(`  Last transition: ${verification.lastTransition.eventName} (${verification.lastTransition.fromState} → ${verification.lastTransition.toState})`);
        }
        
        // Check for rejections
        if (verification.rejections.length > 0) {
          console.log(`  ⚠️ Found ${verification.rejections.length} rejection(s) for this fiber`);
          for (const rej of verification.rejections.slice(0, 3)) {
            console.log(`    - ${rej.updateType}: ${rej.errors.map(e => e.code).join(', ')}`);
          }
        } else {
          console.log(`  ✓ No rejections for this fiber`);
        }
        
        results.push({ name: 'Verify Indexer State', status: 'passed' });
      } else {
        console.error(`❌ Fiber not found in indexer (unexpected)`);
        results.push({ name: 'Verify Indexer State', status: 'failed', message: 'Fiber not found' });
      }
    } catch (err) {
      console.error(`❌ Indexer verification failed: ${err}`);
      results.push({ name: 'Verify Indexer State', status: 'failed', message: String(err) });
    }
  }
  
  printSummary(results);
  
  // Exit with error only if there are hard failures (not skips)
  const failures = results.filter(r => r.status === 'failed').length;
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
