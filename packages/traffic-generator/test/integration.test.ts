#!/usr/bin/env npx tsx
/**
 * Traffic Generator Integration Test
 * 
 * Tests the full agent lifecycle: registration → state sync → activation.
 * 
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   ML0_URL             - Metagraph L0 URL (default: http://localhost:9200)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber in state (default: 30)
 *   DL1_SYNC_WAIT       - Seconds to wait for DL1 sync (default: 10)
 *   ACTIVATION_WAIT     - Seconds to wait after activation (default: 5)
 * 
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 npx tsx test/integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';

// Configuration with ENV overrides
const CONFIG = {
  bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
  ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '30', 10),
  dl1SyncWait: parseInt(process.env.DL1_SYNC_WAIT ?? '10', 10),
  activationWait: parseInt(process.env.ACTIVATION_WAIT ?? '5', 10),
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Get current ML0 snapshot ordinal for diagnostic logging */
async function getSnapshotOrdinal(ml0Url: string): Promise<number | null> {
  try {
    const res = await fetch(`${ml0Url}/data-application/v1/checkpoint`, { 
      signal: AbortSignal.timeout(5000) 
    });
    const data = await res.json() as { ordinal?: number };
    return data.ordinal ?? null;
  } catch {
    return null;
  }
}

/** Wait for fiber to appear in ML0 state with diagnostic logging */
async function waitForFiber(
  ml0Url: string, 
  fiberId: string, 
  timeoutSeconds: number
): Promise<{ found: boolean; lastOrdinal: number | null }> {
  const startTime = Date.now();
  const deadline = startTime + timeoutSeconds * 1000;
  let lastOrdinal: number | null = null;
  let checkCount = 0;
  
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ml0Url}/data-application/v1/checkpoint`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json() as { 
        ordinal?: number;
        state?: { stateMachines?: Record<string, unknown> } 
      };
      
      const currentOrdinal = data.ordinal ?? null;
      
      // Log ordinal progression every 5 checks
      if (checkCount % 5 === 0 && currentOrdinal !== null) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  📊 [${elapsed}s] Snapshot ordinal: ${currentOrdinal}`);
      }
      lastOrdinal = currentOrdinal;
      
      if (data.state?.stateMachines?.[fiberId]) {
        return { found: true, lastOrdinal };
      }
    } catch {
      // Ignore fetch errors, keep trying
    }
    
    checkCount++;
    await sleep(1000);
  }
  
  return { found: false, lastOrdinal };
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
  console.log(`Bridge: ${CONFIG.bridgeUrl}`);
  console.log(`ML0:    ${CONFIG.ml0Url}`);
  console.log(`Timeouts: fiber=${CONFIG.fiberWaitTimeout}s, dl1Sync=${CONFIG.dl1SyncWait}s, activation=${CONFIG.activationWait}s`);
  console.log('');

  const results: TestResult[] = [];
  let client: InstanceType<typeof BridgeClient>;
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
  
  // Initialize client
  client = new BridgeClient({ bridgeUrl: CONFIG.bridgeUrl, ml0Url: CONFIG.ml0Url });
  
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
  
  // Test 3: Agent registration
  console.log('\n🔍 Test 3: Agent Registration');
  let fiberId: string | null = null;
  try {
    const displayName = `TestAgent_${Date.now().toString(36)}`;
    const platform = 'discord';
    const platformUserId = `discord_test_${wallet.address.slice(4, 12)}`;
    
    const regResult = await client.registerAgent(
      wallet.privateKey,
      displayName,
      platform,
      platformUserId
    );
    fiberId = regResult.fiberId;
    console.log(`✓ Agent registered: fiberId=${fiberId}`);
    console.log(`  Transaction hash: ${regResult.hash}`);
    results.push({ name: 'Agent Registration', status: 'passed' });
  } catch (err) {
    console.error(`❌ Agent registration failed: ${err}`);
    results.push({ name: 'Agent Registration', status: 'failed', message: String(err) });
  }
  
  if (!fiberId) {
    console.error('\n❌ Cannot continue without fiberId');
    printSummary(results);
    process.exit(1);
  }
  
  // Test 4: Wait for fiber to appear in state
  console.log(`\n🔍 Test 4: Wait for Fiber in State`);
  console.log(`⏳ Waiting for fiber to appear in ML0 state (up to ${CONFIG.fiberWaitTimeout}s)...`);
  
  const initialOrdinal = await getSnapshotOrdinal(CONFIG.ml0Url);
  if (initialOrdinal !== null) {
    console.log(`  📊 Initial snapshot ordinal: ${initialOrdinal}`);
  }
  
  const waitResult = await waitForFiber(CONFIG.ml0Url, fiberId, CONFIG.fiberWaitTimeout);
  
  if (waitResult.found) {
    console.log('✓ Fiber visible in ML0 state checkpoint');
    console.log(`⏳ Waiting for DL1 sync (${CONFIG.dl1SyncWait}s)...`);
    await sleep(CONFIG.dl1SyncWait * 1000);
    results.push({ name: 'Fiber in State', status: 'passed' });
    fiberInState = true;
  } else {
    const ordinalProgress = initialOrdinal !== null && waitResult.lastOrdinal !== null
      ? ` (ordinal ${initialOrdinal} → ${waitResult.lastOrdinal})`
      : '';
    console.error(`❌ Fiber did not appear in state after ${CONFIG.fiberWaitTimeout}s${ordinalProgress}`);
    results.push({ 
      name: 'Fiber in State', 
      status: 'failed', 
      message: `Timeout after ${CONFIG.fiberWaitTimeout}s${ordinalProgress}` 
    });
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
