#!/usr/bin/env npx tsx
/**
 * Standalone webhook integration test
 * Run: npx tsx scripts/test-webhook.ts
 */

const ML0_URL = process.env.ML0_URL || 'http://localhost:9200';
const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';
const HOST_IP = process.env.HOST_IP || '192.168.176.116';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, message: 'OK', duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, message, duration: Date.now() - start });
    console.log(`❌ ${name}: ${message}`);
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json() as T;
}

async function main() {
  console.log('OttoChain Webhook Integration Tests\n');
  console.log(`ML0: ${ML0_URL}`);
  console.log(`Indexer: ${INDEXER_URL}`);
  console.log(`Host IP: ${HOST_IP}\n`);

  // Test 1: ML0 is accessible
  await test('ML0 node info', async () => {
    const info = await fetchJson<{ state: string }>(`${ML0_URL}/node/info`);
    if (info.state !== 'Ready') {
      throw new Error(`Expected state 'Ready', got '${info.state}'`);
    }
  });

  // Test 2: Indexer is accessible
  await test('Indexer health', async () => {
    const health = await fetchJson<{ status: string }>(`${INDEXER_URL}/health`);
    if (health.status !== 'ok') {
      throw new Error(`Expected status 'ok', got '${health.status}'`);
    }
  });

  // Test 3: Subscribe webhook
  let subscriberId: string | null = null;
  await test('Subscribe webhook', async () => {
    const result = await fetchJson<{ id: string }>(`${ML0_URL}/data-application/v1/webhooks/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callbackUrl: `http://${HOST_IP}:3031/webhook/snapshot`,
        secret: 'test-secret',
      }),
    });
    subscriberId = result.id;
    if (!subscriberId) {
      throw new Error('No subscriber ID returned');
    }
  });

  // Test 4: List subscribers
  await test('List subscribers', async () => {
    const result = await fetchJson<{ subscribers: Array<{ id: string }> }>(
      `${ML0_URL}/data-application/v1/webhooks/subscribers`
    );
    if (!result.subscribers.some((s) => s.id === subscriberId)) {
      throw new Error('Subscriber not found in list');
    }
  });

  // Test 5: Wait for snapshot and webhook delivery
  await test('Webhook delivery on snapshot', async () => {
    const initial = await fetchJson<{ ordinal: number }>(`${ML0_URL}/data-application/v1/checkpoint`);
    const initialOrdinal = initial.ordinal;
    
    // Wait for next snapshot (up to 60s)
    let currentOrdinal = initialOrdinal;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const current = await fetchJson<{ ordinal: number }>(`${ML0_URL}/data-application/v1/checkpoint`);
      currentOrdinal = current.ordinal;
      if (currentOrdinal > initialOrdinal) break;
    }
    
    if (currentOrdinal === initialOrdinal) {
      throw new Error('Snapshot did not progress within 60s');
    }

    // Check webhook was delivered
    await new Promise((r) => setTimeout(r, 5000)); // Increased from 2s for webhook delivery timing
    const subscribers = await fetchJson<{ subscribers: Array<{ lastDeliveryAt: string | null; failCount: number }> }>(
      `${ML0_URL}/data-application/v1/webhooks/subscribers`
    );
    const sub = subscribers.subscribers[0];
    
    if (!sub.lastDeliveryAt) {
      throw new Error('Webhook was not delivered');
    }
    if (sub.failCount > 0) {
      throw new Error(`Webhook had ${sub.failCount} failures`);
    }
  });

  // Test 6: Indexer processed snapshot
  await test('Indexer processed snapshot', async () => {
    const status = await fetchJson<{ lastIndexedOrdinal: number | null }>(`${INDEXER_URL}/status`);
    if (status.lastIndexedOrdinal === null) {
      throw new Error('Indexer has not processed any snapshots');
    }
  });

  // Test 7: Unsubscribe
  if (subscriberId) {
    await test('Unsubscribe webhook', async () => {
      const response = await fetch(`${ML0_URL}/data-application/v1/webhooks/subscribe/${subscriberId}`, {
        method: 'DELETE',
      });
      if (response.status !== 204) {
        throw new Error(`Expected 204, got ${response.status}`);
      }
    });
  }

  // =========================================================================
  // Rejection Webhook Tests (Option A: Direct indexer testing)
  // =========================================================================
  
  const testFiberId = '00000000-0000-4000-8000-000000000001';
  const testUpdateHash = `test-rejection-${Date.now()}`;
  
  // Test 8: POST rejection to indexer
  await test('Rejection webhook endpoint', async () => {
    const rejection = {
      event: 'transaction.rejected',
      ordinal: 999,
      timestamp: new Date().toISOString(),
      metagraphId: 'test-metagraph',
      rejection: {
        updateType: 'CreateStateMachine',
        fiberId: testFiberId,
        targetSequenceNumber: 0,
        errors: [
          { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
          { code: 'INSUFFICIENT_BALANCE', message: 'Not enough tokens' }
        ],
        signers: ['DAG123abc', 'DAG456def'],
        updateHash: testUpdateHash,
      }
    };
    
    const result = await fetchJson<{ accepted: boolean; updateHash?: string }>(`${INDEXER_URL}/webhook/rejection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rejection)
    });
    
    if (!result.accepted) {
      throw new Error('Rejection not accepted');
    }
  });

  // Test 9: Query rejections list
  await test('Query rejections list', async () => {
    const result = await fetchJson<{ rejections: Array<{ updateHash: string }>; total: number }>(`${INDEXER_URL}/api/rejections`);
    
    if (!result.rejections.some(r => r.updateHash === testUpdateHash)) {
      throw new Error('Test rejection not found in list');
    }
  });

  // Test 10: Query rejection by hash
  await test('Query rejection by updateHash', async () => {
    const result = await fetchJson<{ updateHash: string; errors: Array<{ code: string }> }>(
      `${INDEXER_URL}/api/rejections/${testUpdateHash}`
    );
    
    if (result.updateHash !== testUpdateHash) {
      throw new Error(`Expected updateHash ${testUpdateHash}, got ${result.updateHash}`);
    }
    if (result.errors.length !== 2) {
      throw new Error(`Expected 2 errors, got ${result.errors.length}`);
    }
  });

  // Test 11: Query rejections by fiberId
  await test('Query rejections by fiberId', async () => {
    const result = await fetchJson<{ rejections: Array<{ fiberId: string }>; total: number }>(
      `${INDEXER_URL}/api/fibers/${testFiberId}/rejections`
    );
    
    if (result.total < 1) {
      throw new Error('No rejections found for test fiber');
    }
    if (!result.rejections.every(r => r.fiberId === testFiberId)) {
      throw new Error('Returned rejections have wrong fiberId');
    }
  });

  // Test 12: Rejection deduplication
  await test('Rejection deduplication', async () => {
    const rejection = {
      event: 'transaction.rejected',
      ordinal: 999,
      timestamp: new Date().toISOString(),
      metagraphId: 'test-metagraph',
      rejection: {
        updateType: 'CreateStateMachine',
        fiberId: testFiberId,
        errors: [{ code: 'TEST', message: 'Duplicate test' }],
        signers: ['DAG123abc'],
        updateHash: testUpdateHash, // Same hash as before
      }
    };
    
    const result = await fetchJson<{ accepted: boolean; alreadyIndexed?: boolean }>(`${INDEXER_URL}/webhook/rejection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rejection)
    });
    
    if (!result.alreadyIndexed) {
      throw new Error('Expected alreadyIndexed=true for duplicate');
    }
  });

  // Test 13: Status includes totalRejections
  await test('Status includes totalRejections', async () => {
    const status = await fetchJson<{ totalRejections?: number }>(`${INDEXER_URL}/status`);
    
    if (typeof status.totalRejections !== 'number') {
      throw new Error('totalRejections not in status');
    }
    if (status.totalRejections < 1) {
      throw new Error('totalRejections should be >= 1');
    }
  });

  // Summary
  console.log('\n========================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    process.exit(1);
  }
  
  console.log('All tests passed! ✅');
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
