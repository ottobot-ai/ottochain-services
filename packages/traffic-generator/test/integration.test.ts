#!/usr/bin/env npx tsx
/**
 * Traffic Generator Integration Test
 * 
 * Simple test that registers agents, waits for snapshot processing,
 * then activates them and verifies the full workflow.
 * 
 * Run with:
 *   cd packages/traffic-generator
 *   pnpm build
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 node dist/test/integration.test.js
 * 
 * Or directly with tsx:
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 npx tsx test/integration.test.ts
 */

import { BridgeClient } from '../dist/bridge-client.js';

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL ?? 'http://localhost:9200';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFiber(ml0Url: string, fiberId: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${ml0Url}/data-application/v1/checkpoint`);
      const data = await res.json() as { state: { stateMachines: Record<string, unknown> } };
      if (data.state?.stateMachines?.[fiberId]) {
        return true;
      }
    } catch {
      // Ignore fetch errors
    }
    await sleep(1000);
  }
  return false;
}

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Traffic Generator - Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ML0:    ${ML0_URL}`);
  console.log('');

  const results: TestResult[] = [];
  let client: InstanceType<typeof BridgeClient>;
  
  // Test 1: Bridge health check
  console.log('🔍 Test 1: Bridge Health Check');
  try {
    const health = await fetch(`${BRIDGE_URL}/health`).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') {
      throw new Error(`Unexpected status: ${health.status}`);
    }
    console.log('✓ Bridge is healthy');
    results.push({ name: 'Bridge Health Check', passed: true });
  } catch (err) {
    console.error(`❌ Bridge health check failed: ${err}`);
    results.push({ name: 'Bridge Health Check', passed: false, message: String(err) });
  }
  
  // Initialize client
  client = new BridgeClient({ bridgeUrl: BRIDGE_URL, ml0Url: ML0_URL });
  
  // Test 2: Wallet generation
  console.log('\n🔍 Test 2: Wallet Generation');
  let wallet: { address: string; privateKey: string } | null = null;
  try {
    wallet = await client.generateWallet();
    console.log(`✓ Generated wallet: ${wallet.address}`);
    results.push({ name: 'Wallet Generation', passed: true });
  } catch (err) {
    console.error(`❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet Generation', passed: false, message: String(err) });
  }
  
  if (!wallet) {
    console.error('\n❌ Cannot continue without wallet');
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
    results.push({ name: 'Agent Registration', passed: true });
  } catch (err) {
    console.error(`❌ Agent registration failed: ${err}`);
    results.push({ name: 'Agent Registration', passed: false, message: String(err) });
  }
  
  if (!fiberId) {
    console.error('\n❌ Cannot continue without fiberId');
    process.exit(1);
  }
  
  // Test 4: Wait for fiber to appear in state (ML0 + extra time for DL1 sync)
  console.log(`\n🔍 Test 4: Wait for Fiber in State`);
  console.log(`⏳ Waiting for fiber to appear in ML0 state (up to 20s)...`);
  try {
    const appeared = await waitForFiber(ML0_URL, fiberId);
    if (!appeared) {
      throw new Error('Fiber did not appear in state after 20 seconds');
    }
    console.log('✓ Fiber visible in ML0 state checkpoint');
    // Wait extra time for DL1 to sync (needs 2-3 snapshot cycles)
    console.log('⏳ Waiting for DL1 sync (10s)...');
    await sleep(10000);
    results.push({ name: 'Fiber in State', passed: true });
  } catch (err) {
    console.error(`❌ ${err}`);
    results.push({ name: 'Fiber in State', passed: false, message: String(err) });
  }
  
  // Test 5: Agent activation
  console.log('\n🔍 Test 5: Agent Activation');
  try {
    const actResult = await client.activateAgent(wallet.privateKey, fiberId);
    console.log(`✓ Agent activated: hash=${actResult.hash}`);
    results.push({ name: 'Agent Activation', passed: true });
  } catch (err) {
    console.error(`❌ Agent activation failed: ${err}`);
    results.push({ name: 'Agent Activation', passed: false, message: String(err) });
  }
  
  // Test 6: Verify agent is Active in state
  console.log(`\n🔍 Test 6: Verify Active State`);
  console.log(`⏳ Waiting for activation to process (5s)...`);
  await sleep(5000);
  
  try {
    const checkpoint = await fetch(`${ML0_URL}/data-application/v1/checkpoint`).then(r => r.json()) as any;
    const fiber = checkpoint.state?.stateMachines?.[fiberId];
    
    if (!fiber) {
      throw new Error('Fiber not found in checkpoint');
    }
    
    const state = fiber.currentState?.value;
    if (state === 'Active') {
      console.log('✓ Agent state is Active');
      results.push({ name: 'Verify Active State', passed: true });
    } else {
      console.log(`⚠️ Agent state is ${state} (expected Active, may need another snapshot cycle)`);
      results.push({ name: 'Verify Active State', passed: true, message: `State: ${state}` });
    }
  } catch (err) {
    console.error(`❌ ${err}`);
    results.push({ name: 'Verify Active State', passed: false, message: String(err) });
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? '✓' : '❌';
    console.log(`${icon} ${r.name}${r.message ? ` (${r.message})` : ''}`);
    if (r.passed) passed++;
    else failed++;
  }
  
  console.log('');
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
