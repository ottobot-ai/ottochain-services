#!/usr/bin/env npx tsx
/**
 * SimpleOrder Fiber Workflow Integration Test
 *
 * Tests the full SimpleOrder fiber lifecycle:
 *   - Create a SimpleOrder fiber (PENDING state)
 *   - Execute PENDING → FILLED (fill event)
 *   - Verify state change reflected in ML0
 *   - Verify state change reflected in indexer
 *   - Assert no rejections for each transition
 *
 * A second test covers the PENDING → CANCELLED path.
 *
 * Environment variables:
 *   BRIDGE_URL          - Bridge service URL (default: http://localhost:3030)
 *   ML0_URL             - Metagraph L0 URL (default: http://localhost:9200)
 *   INDEXER_URL         - Indexer service URL (default: http://localhost:3031)
 *   FIBER_WAIT_TIMEOUT  - Max seconds to wait for fiber in state (default: 30)
 *   INDEXER_WAIT_TIMEOUT- Max ms to wait for indexer (default: 30000)
 *
 * Run with:
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 INDEXER_URL=http://localhost:3031 npx tsx test/simple-order.integration.test.ts
 */

import assert from 'node:assert';
import { BridgeClient } from '../dist/bridge-client.js';

// ============================================================================
// Config
// ============================================================================

const CONFIG = {
  bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
  ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
  indexerUrl: process.env.INDEXER_URL,
  fiberWaitTimeout: parseInt(process.env.FIBER_WAIT_TIMEOUT ?? '30', 10),
  indexerWaitTimeoutMs: parseInt(process.env.INDEXER_WAIT_TIMEOUT ?? '30000', 10),
};

// ============================================================================
// SimpleOrder state machine definition
// Matches fiber-definitions.ts simpleOrder entry:
//   PENDING → FILLED (fill)
//   PENDING → CANCELLED (cancel)
// ============================================================================

const SIMPLE_ORDER_DEFINITION = {
  states: {
    PENDING:   { id: 'PENDING',   isFinal: false, metadata: null },
    FILLED:    { id: 'FILLED',    isFinal: true,  metadata: null },
    CANCELLED: { id: 'CANCELLED', isFinal: true,  metadata: null },
  },
  initialState: 'PENDING',
  transitions: [
    {
      from: 'PENDING',
      to: 'FILLED',
      eventName: 'fill',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { filledAt: { var: 'event.timestamp' } }] },
      dependencies: [],
    },
    {
      from: 'PENDING',
      to: 'CANCELLED',
      eventName: 'cancel',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { cancelReason: { var: 'event.reason' } }] },
      dependencies: [],
    },
  ],
  metadata: { name: 'SimpleOrder', description: 'Order fulfillment tracking' },
};

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wait for a fiber to appear in ML0 and optionally reach a target state */
async function waitForFiberState(
  ml0Url: string,
  fiberId: string,
  targetState: string | null,
  timeoutSeconds: number
): Promise<{ found: boolean; currentState: string | null }> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ml0Url}/data-application/v1/state-machines/${fiberId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { currentState?: string; fiberId?: string };
        if (data?.fiberId) {
          const state = data.currentState ?? null;
          if (targetState === null || state === targetState) {
            return { found: true, currentState: state };
          }
        }
      }
    } catch {
      // Keep polling
    }
    await sleep(1000);
  }

  return { found: false, currentState: null };
}

/** Wait for a fiber to appear in the indexer with optional state check */
async function waitForIndexerState(
  indexerUrl: string,
  fiberId: string,
  targetState: string | null,
  timeoutMs: number
): Promise<{ found: boolean; currentState: string | null }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${indexerUrl}/fibers/${fiberId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { currentState?: string };
        if (data) {
          const state = data.currentState ?? null;
          if (targetState === null || state === targetState) {
            return { found: true, currentState: state };
          }
        }
      }
    } catch {
      // Keep polling
    }
    await sleep(2000);
  }

  return { found: false, currentState: null };
}

// ============================================================================
// Test types
// ============================================================================

type TestStatus = 'passed' | 'failed' | 'skipped';

interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
}

// ============================================================================
// Test Suite
// ============================================================================

async function runTestSuite(
  suiteName: string,
  tests: () => Promise<TestResult[]>
): Promise<TestResult[]> {
  console.log(`\n${'─'.repeat(63)}`);
  console.log(` ${suiteName}`);
  console.log(`${'─'.repeat(63)}`);
  return tests();
}

/** Suite 1: PENDING → FILLED path */
async function suiteFilledPath(client: InstanceType<typeof BridgeClient>): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // --- 1a. Generate wallet ---
  console.log('\n🔍 Test 1a: Wallet generation (fill path)');
  let wallet: { address: string; privateKey: string } | null = null;
  try {
    wallet = await client.generateWallet();
    console.log(`✓ Generated wallet: ${wallet.address}`);
    results.push({ name: 'Wallet generation (fill)', status: 'passed' });
  } catch (err) {
    console.error(`❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet generation (fill)', status: 'failed', message: String(err) });
    return results; // Can't continue without wallet
  }

  // --- 1b. Create SimpleOrder fiber (→ PENDING) ---
  console.log('\n🔍 Test 1b: Create SimpleOrder fiber (PENDING)');
  let fiberId: string | null = null;
  try {
    const initialData = {
      buyer: wallet.address,
      seller: wallet.address, // self-signed for test determinism
      amount: 250,
      orderId: `test-order-${Date.now().toString(36)}`,
    };

    const createResult = await client.createFiber(wallet.privateKey, SIMPLE_ORDER_DEFINITION, initialData);
    fiberId = createResult.fiberId;
    console.log(`✓ Fiber created: ${fiberId} (hash=${createResult.hash})`);
    results.push({ name: 'Create SimpleOrder (PENDING)', status: 'passed' });
  } catch (err) {
    console.error(`❌ Create fiber failed: ${err}`);
    results.push({ name: 'Create SimpleOrder (PENDING)', status: 'failed', message: String(err) });
    return results;
  }

  // --- 1c. Verify PENDING in ML0 ---
  console.log(`\n🔍 Test 1c: Verify PENDING state in ML0 (fiberId=${fiberId})`);
  const pendingResult = await waitForFiberState(
    CONFIG.ml0Url, fiberId!, 'PENDING', CONFIG.fiberWaitTimeout
  );
  if (!pendingResult.found) {
    console.error(`❌ Fiber did not appear in PENDING within ${CONFIG.fiberWaitTimeout}s`);
    results.push({ name: 'Verify PENDING in ML0', status: 'failed', message: 'Timeout' });
    return results;
  }
  console.log(`✓ Fiber is PENDING in ML0`);
  results.push({ name: 'Verify PENDING in ML0', status: 'passed' });

  // Rejection check after creation
  try {
    await client.assertNoRejections(fiberId!, 'create');
    console.log(`  ✓ No rejections after create`);
  } catch (err) {
    results.push({ name: 'No rejections after create (fill path)', status: 'failed', message: String(err) });
  }

  // --- 1d. Transition PENDING → FILLED ---
  console.log('\n🔍 Test 1d: Transition PENDING → FILLED (fill event)');
  try {
    const fillResult = await client.transitionFiber(wallet.privateKey, fiberId!, 'fill', {
      timestamp: new Date().toISOString(),
      filledBy: wallet.address,
    });
    console.log(`✓ Transition submitted: hash=${fillResult.hash}`);
    results.push({ name: 'Transition PENDING → FILLED', status: 'passed' });
  } catch (err) {
    console.error(`❌ Transition failed: ${err}`);
    results.push({ name: 'Transition PENDING → FILLED', status: 'failed', message: String(err) });
    return results;
  }

  // --- 1e. Verify FILLED in ML0 ---
  console.log('\n🔍 Test 1e: Verify FILLED state in ML0');
  const filledResult = await waitForFiberState(
    CONFIG.ml0Url, fiberId!, 'FILLED', CONFIG.fiberWaitTimeout
  );
  if (!filledResult.found) {
    // State may be in transition — report current state
    const stateNote = filledResult.currentState ? ` (currently: ${filledResult.currentState})` : '';
    console.error(`❌ Fiber did not reach FILLED within ${CONFIG.fiberWaitTimeout}s${stateNote}`);
    results.push({ name: 'Verify FILLED in ML0', status: 'failed', message: `Timeout${stateNote}` });
  } else {
    console.log(`✓ Fiber is FILLED in ML0`);
    results.push({ name: 'Verify FILLED in ML0', status: 'passed' });
  }

  // Rejection check after fill transition
  try {
    await client.assertNoRejections(fiberId!, 'fill transition');
    console.log(`  ✓ No rejections after fill`);
    results.push({ name: 'No rejections for fill transition', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Rejection detected: ${err}`);
    results.push({ name: 'No rejections for fill transition', status: 'failed', message: String(err) });
  }

  // --- 1f. Verify FILLED in indexer ---
  if (CONFIG.indexerUrl) {
    console.log('\n🔍 Test 1f: Verify FILLED state in indexer');
    const indexerResult = await waitForIndexerState(
      CONFIG.indexerUrl, fiberId!, 'FILLED', CONFIG.indexerWaitTimeoutMs
    );
    if (!indexerResult.found) {
      console.error(`❌ Fiber not FILLED in indexer after ${CONFIG.indexerWaitTimeoutMs / 1000}s`);
      results.push({ name: 'Verify FILLED in indexer', status: 'failed', message: 'Timeout' });
    } else {
      console.log(`✓ Fiber is FILLED in indexer (currentState=${indexerResult.currentState})`);
      results.push({ name: 'Verify FILLED in indexer', status: 'passed' });
    }
  } else {
    console.log('\n⏭️  Test 1f: Skipped (INDEXER_URL not set)');
    results.push({ name: 'Verify FILLED in indexer', status: 'skipped', message: 'INDEXER_URL not set' });
  }

  return results;
}

/** Suite 2: PENDING → CANCELLED path */
async function suiteCancelledPath(client: InstanceType<typeof BridgeClient>): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // --- 2a. Generate wallet ---
  console.log('\n🔍 Test 2a: Wallet generation (cancel path)');
  let wallet: { address: string; privateKey: string } | null = null;
  try {
    wallet = await client.generateWallet();
    console.log(`✓ Generated wallet: ${wallet.address}`);
    results.push({ name: 'Wallet generation (cancel)', status: 'passed' });
  } catch (err) {
    console.error(`❌ Wallet generation failed: ${err}`);
    results.push({ name: 'Wallet generation (cancel)', status: 'failed', message: String(err) });
    return results;
  }

  // --- 2b. Create SimpleOrder fiber ---
  console.log('\n🔍 Test 2b: Create SimpleOrder fiber (PENDING) for cancel path');
  let fiberId: string | null = null;
  try {
    const initialData = {
      buyer: wallet.address,
      seller: wallet.address,
      amount: 100,
      orderId: `test-cancel-${Date.now().toString(36)}`,
    };

    const createResult = await client.createFiber(wallet.privateKey, SIMPLE_ORDER_DEFINITION, initialData);
    fiberId = createResult.fiberId;
    console.log(`✓ Fiber created: ${fiberId} (hash=${createResult.hash})`);
    results.push({ name: 'Create SimpleOrder (cancel path)', status: 'passed' });
  } catch (err) {
    console.error(`❌ Create fiber failed: ${err}`);
    results.push({ name: 'Create SimpleOrder (cancel path)', status: 'failed', message: String(err) });
    return results;
  }

  // --- 2c. Verify PENDING in ML0 ---
  console.log('\n🔍 Test 2c: Verify PENDING state in ML0 (cancel path)');
  const pendingResult = await waitForFiberState(
    CONFIG.ml0Url, fiberId!, 'PENDING', CONFIG.fiberWaitTimeout
  );
  if (!pendingResult.found) {
    console.error(`❌ Fiber did not appear in PENDING within ${CONFIG.fiberWaitTimeout}s`);
    results.push({ name: 'Verify PENDING in ML0 (cancel path)', status: 'failed', message: 'Timeout' });
    return results;
  }
  console.log(`✓ Fiber is PENDING in ML0`);
  results.push({ name: 'Verify PENDING in ML0 (cancel path)', status: 'passed' });

  // No rejections after create
  try {
    await client.assertNoRejections(fiberId!, 'create (cancel path)');
    console.log(`  ✓ No rejections after create`);
  } catch (err) {
    results.push({ name: 'No rejections after create (cancel path)', status: 'failed', message: String(err) });
  }

  // --- 2d. Transition PENDING → CANCELLED ---
  console.log('\n🔍 Test 2d: Transition PENDING → CANCELLED (cancel event)');
  try {
    const cancelResult = await client.transitionFiber(wallet.privateKey, fiberId!, 'cancel', {
      reason: 'Test cancellation — integration test',
      cancelledBy: wallet.address,
    });
    console.log(`✓ Transition submitted: hash=${cancelResult.hash}`);
    results.push({ name: 'Transition PENDING → CANCELLED', status: 'passed' });
  } catch (err) {
    console.error(`❌ Cancel transition failed: ${err}`);
    results.push({ name: 'Transition PENDING → CANCELLED', status: 'failed', message: String(err) });
    return results;
  }

  // --- 2e. Verify CANCELLED in ML0 ---
  console.log('\n🔍 Test 2e: Verify CANCELLED state in ML0');
  const cancelledResult = await waitForFiberState(
    CONFIG.ml0Url, fiberId!, 'CANCELLED', CONFIG.fiberWaitTimeout
  );
  if (!cancelledResult.found) {
    const stateNote = cancelledResult.currentState ? ` (currently: ${cancelledResult.currentState})` : '';
    console.error(`❌ Fiber did not reach CANCELLED within ${CONFIG.fiberWaitTimeout}s${stateNote}`);
    results.push({ name: 'Verify CANCELLED in ML0', status: 'failed', message: `Timeout${stateNote}` });
  } else {
    console.log(`✓ Fiber is CANCELLED in ML0`);
    results.push({ name: 'Verify CANCELLED in ML0', status: 'passed' });
  }

  // Rejection check after cancel
  try {
    await client.assertNoRejections(fiberId!, 'cancel transition');
    console.log(`  ✓ No rejections after cancel`);
    results.push({ name: 'No rejections for cancel transition', status: 'passed' });
  } catch (err) {
    console.error(`  ❌ Rejection detected: ${err}`);
    results.push({ name: 'No rejections for cancel transition', status: 'failed', message: String(err) });
  }

  // --- 2f. Verify CANCELLED in indexer ---
  if (CONFIG.indexerUrl) {
    console.log('\n🔍 Test 2f: Verify CANCELLED state in indexer');
    const indexerResult = await waitForIndexerState(
      CONFIG.indexerUrl, fiberId!, 'CANCELLED', CONFIG.indexerWaitTimeoutMs
    );
    if (!indexerResult.found) {
      console.error(`❌ Fiber not CANCELLED in indexer after ${CONFIG.indexerWaitTimeoutMs / 1000}s`);
      results.push({ name: 'Verify CANCELLED in indexer', status: 'failed', message: 'Timeout' });
    } else {
      console.log(`✓ Fiber is CANCELLED in indexer (currentState=${indexerResult.currentState})`);
      results.push({ name: 'Verify CANCELLED in indexer', status: 'passed' });
    }
  } else {
    console.log('\n⏭️  Test 2f: Skipped (INDEXER_URL not set)');
    results.push({ name: 'Verify CANCELLED in indexer', status: 'skipped', message: 'INDEXER_URL not set' });
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain — SimpleOrder Fiber Workflow Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Bridge:  ${CONFIG.bridgeUrl}`);
  console.log(`ML0:     ${CONFIG.ml0Url}`);
  console.log(`Indexer: ${CONFIG.indexerUrl ?? '(not set — indexer tests skipped)'}`);
  console.log(`Timeout: ${CONFIG.fiberWaitTimeout}s`);
  console.log('');

  // Bridge health check
  try {
    const health = await fetch(`${CONFIG.bridgeUrl}/health`, {
      signal: AbortSignal.timeout(10000),
    }).then(r => r.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Unexpected bridge status: ${health.status}`);
    console.log('✓ Bridge is healthy');
  } catch (err) {
    console.error(`❌ Bridge health check failed: ${err}`);
    process.exit(1);
  }

  const client = new BridgeClient({
    bridgeUrl: CONFIG.bridgeUrl,
    ml0Url: CONFIG.ml0Url,
    indexerUrl: CONFIG.indexerUrl,
  });

  const fillResults = await runTestSuite(
    'Suite 1: SimpleOrder PENDING → FILLED',
    () => suiteFilledPath(client)
  );

  const cancelResults = await runTestSuite(
    'Suite 2: SimpleOrder PENDING → CANCELLED',
    () => suiteCancelledPath(client)
  );

  const allResults = [...fillResults, ...cancelResults];

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0, skipped = 0;
  for (const r of allResults) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '⏭️ ' : '❌';
    console.log(`${icon} ${r.name}${r.message ? ` (${r.message})` : ''}`);
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }

  console.log('');
  console.log(`Passed:  ${passed}/${allResults.length}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}/${allResults.length}`);
  if (failed > 0) {
    console.log(`Failed:  ${failed}/${allResults.length}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
