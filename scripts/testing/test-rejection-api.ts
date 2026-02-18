#!/usr/bin/env npx tsx
/**
 * Integration tests for the rejection query API
 *
 * Tests all three endpoints:
 *   GET /api/rejections               - list with filters
 *   GET /api/rejections/:updateHash   - single lookup
 *   GET /api/fibers/:fiberId/rejections - fiber-specific
 *
 * Usage:
 *   INDEXER_URL=http://localhost:3031 npx tsx scripts/testing/test-rejection-api.ts
 *
 * The script:
 *   1. Seeds test rejections via POST /webhook/rejection
 *   2. Verifies each query endpoint and filter combination
 *   3. Cleans up seeded data (via Prisma direct)
 *   4. Prints a pass/fail summary
 */

import { PrismaClient } from '@prisma/client';

const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';
const prisma = new PrismaClient();

// ── Types ────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

interface RejectionRecord {
  id: number;
  ordinal: number;
  timestamp: string;
  updateType: string;
  fiberId: string;
  updateHash: string;
  errors: { code: string; message: string }[];
  signers: string[];
  createdAt: string;
  rawPayload?: unknown;
  hasMore?: boolean;
}

interface RejectionListResponse {
  rejections: RejectionRecord[];
  total: number;
  hasMore: boolean;
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, message: 'OK', duration: Date.now() - start });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, message, duration: Date.now() - start });
    console.log(`  ❌ ${name}: ${message}`);
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ── Test data ─────────────────────────────────────────────────────────────────

const FIBER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIBER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const SIGNER_X = 'DAGtest00000000000000000000000000000000001';
const SIGNER_Y = 'DAGtest00000000000000000000000000000000002';

const testRejections = [
  {
    event: 'transaction.rejected',
    ordinal: 1000,
    timestamp: new Date('2026-01-01T10:00:00Z').toISOString(),
    metagraphId: 'test-metagraph',
    rejection: {
      updateType: 'CreateStateMachine',
      fiberId: FIBER_A,
      errors: [{ code: 'FiberAlreadyExists', message: 'Fiber already exists' }],
      signers: [SIGNER_X],
      updateHash: 'testhash0000000000000001',
    },
  },
  {
    event: 'transaction.rejected',
    ordinal: 1001,
    timestamp: new Date('2026-01-01T11:00:00Z').toISOString(),
    metagraphId: 'test-metagraph',
    rejection: {
      updateType: 'TransitionStateMachine',
      fiberId: FIBER_A,
      errors: [
        { code: 'NotSignedByOwner', message: 'Not signed by fiber owner' },
        { code: 'InvalidState', message: 'Transition not valid from current state' },
      ],
      signers: [SIGNER_Y],
      updateHash: 'testhash0000000000000002',
    },
  },
  {
    event: 'transaction.rejected',
    ordinal: 1002,
    timestamp: new Date('2026-01-01T12:00:00Z').toISOString(),
    metagraphId: 'test-metagraph',
    rejection: {
      updateType: 'ArchiveStateMachine',
      fiberId: FIBER_B,
      errors: [{ code: 'FiberNotActive', message: 'Fiber is not active' }],
      signers: [SIGNER_X, SIGNER_Y],
      updateHash: 'testhash0000000000000003',
    },
  },
];

// ── Seed helper ───────────────────────────────────────────────────────────────

async function seedRejections(): Promise<void> {
  for (const payload of testRejections) {
    await fetchJson<{ accepted: boolean }>(`${INDEXER_URL}/webhook/rejection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

// ── Cleanup helper ────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  const hashes = testRejections.map(r => r.rejection.updateHash);
  await prisma.rejectedTransaction.deleteMany({
    where: { updateHash: { in: hashes } },
  });
}

// ── Main test suite ───────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Rejection API Integration Tests');
  console.log(`Indexer: ${INDEXER_URL}`);
  console.log('='.repeat(60));
  console.log();

  // ── Pre-flight ────────────────────────────────────────────────────────────
  console.log('Pre-flight:');
  await test('Indexer health check', async () => {
    const health = await fetchJson<{ status: string }>(`${INDEXER_URL}/health`);
    assert(health.status === 'ok', `Expected status 'ok', got '${health.status}'`);
  });

  await test('Seed test rejections via POST /webhook/rejection', seedRejections);

  // Small delay to allow any async processing
  await new Promise(r => setTimeout(r, 200));

  // ── GET /api/rejections ───────────────────────────────────────────────────
  console.log('\nGET /api/rejections:');

  await test('Returns rejection list with total and hasMore', async () => {
    const result = await fetchJson<RejectionListResponse>(`${INDEXER_URL}/api/rejections`);
    assert(Array.isArray(result.rejections), 'Expected rejections array');
    assert(typeof result.total === 'number', 'Expected total number');
    assert(typeof result.hasMore === 'boolean', 'Expected hasMore boolean');
    assert(result.total >= 3, `Expected at least 3 total, got ${result.total}`);
  });

  await test('Rejection records have expected fields', async () => {
    const result = await fetchJson<RejectionListResponse>(`${INDEXER_URL}/api/rejections`);
    const r = result.rejections[0];
    assert(typeof r.id === 'number', 'Missing id');
    assert(typeof r.ordinal === 'number', 'Missing ordinal');
    assert(typeof r.timestamp === 'string', 'Missing timestamp');
    assert(typeof r.updateType === 'string', 'Missing updateType');
    assert(typeof r.fiberId === 'string', 'Missing fiberId');
    assert(typeof r.updateHash === 'string', 'Missing updateHash');
    assert(Array.isArray(r.errors), 'errors should be array');
    assert(Array.isArray(r.signers), 'signers should be array');
  });

  await test('Filter by fiberId (FIBER_A)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fiberId=${FIBER_A}`
    );
    assert(result.rejections.length >= 2, `Expected ≥2, got ${result.rejections.length}`);
    for (const r of result.rejections) {
      assert(r.fiberId === FIBER_A, `Expected fiberId=${FIBER_A}, got ${r.fiberId}`);
    }
  });

  await test('Filter by fiberId (FIBER_B)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fiberId=${FIBER_B}`
    );
    assert(result.rejections.length >= 1, `Expected ≥1, got ${result.rejections.length}`);
    for (const r of result.rejections) {
      assert(r.fiberId === FIBER_B, `Expected fiberId=${FIBER_B}`);
    }
  });

  await test('Filter by updateType (TransitionStateMachine)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?updateType=TransitionStateMachine`
    );
    assert(result.rejections.length >= 1, `Expected ≥1`);
    for (const r of result.rejections) {
      assert(r.updateType === 'TransitionStateMachine', `Wrong updateType: ${r.updateType}`);
    }
  });

  await test('Filter by signer (SIGNER_X, array contains)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?signer=${SIGNER_X}`
    );
    assert(result.rejections.length >= 2, `Expected ≥2 (hash1 + hash3), got ${result.rejections.length}`);
    for (const r of result.rejections) {
      assert(r.signers.includes(SIGNER_X), `SIGNER_X not in signers: ${JSON.stringify(r.signers)}`);
    }
  });

  await test('Filter by signer (SIGNER_Y, array contains)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?signer=${SIGNER_Y}`
    );
    assert(result.rejections.length >= 2, `Expected ≥2 (hash2 + hash3), got ${result.rejections.length}`);
    for (const r of result.rejections) {
      assert(r.signers.includes(SIGNER_Y), `SIGNER_Y not in signers`);
    }
  });

  await test('Filter by errorCode (NotSignedByOwner, JSONB contains)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?errorCode=NotSignedByOwner`
    );
    assert(result.rejections.length >= 1, 'Expected ≥1');
    for (const r of result.rejections) {
      assert(
        r.errors.some(e => e.code === 'NotSignedByOwner'),
        `NotSignedByOwner not in errors: ${JSON.stringify(r.errors)}`
      );
    }
  });

  await test('Filter by errorCode (FiberNotActive)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?errorCode=FiberNotActive`
    );
    assert(result.rejections.length >= 1, 'Expected ≥1');
    for (const r of result.rejections) {
      assert(r.errors.some(e => e.code === 'FiberNotActive'), 'FiberNotActive not in errors');
    }
  });

  await test('Filter by fromOrdinal (1001)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fromOrdinal=1001`
    );
    for (const r of result.rejections) {
      assert(r.ordinal >= 1001, `Expected ordinal ≥1001, got ${r.ordinal}`);
    }
  });

  await test('Filter by toOrdinal (1001)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?toOrdinal=1001`
    );
    for (const r of result.rejections) {
      assert(r.ordinal <= 1001, `Expected ordinal ≤1001, got ${r.ordinal}`);
    }
  });

  await test('Filter by ordinal range (1001..1001)', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fromOrdinal=1001&toOrdinal=1001`
    );
    assert(result.rejections.length >= 1, 'Expected ≥1');
    for (const r of result.rejections) {
      assert(r.ordinal === 1001, `Expected ordinal=1001, got ${r.ordinal}`);
    }
  });

  await test('Pagination: limit=1 offset=0', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?limit=1&offset=0`
    );
    assert(result.rejections.length === 1, `Expected 1, got ${result.rejections.length}`);
    assert(result.hasMore === true || result.total === 1, 'Expected hasMore=true or total=1');
  });

  await test('Pagination: limit=1 offset=1 has different record', async () => {
    const page0 = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?limit=1&offset=0`
    );
    const page1 = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?limit=1&offset=1`
    );
    if (page0.total >= 2) {
      assert(
        page0.rejections[0].id !== page1.rejections[0].id,
        'Expected different record on offset=1'
      );
    }
  });

  await test('Combined filters: fiberId + errorCode', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/rejections?fiberId=${FIBER_A}&errorCode=NotSignedByOwner`
    );
    for (const r of result.rejections) {
      assert(r.fiberId === FIBER_A, `Wrong fiberId`);
      assert(r.errors.some(e => e.code === 'NotSignedByOwner'), 'Wrong errorCode');
    }
  });

  // ── GET /api/rejections/:updateHash ───────────────────────────────────────
  console.log('\nGET /api/rejections/:updateHash:');

  await test('Returns single rejection by updateHash', async () => {
    const hash = testRejections[0].rejection.updateHash;
    const result = await fetchJson<RejectionRecord>(
      `${INDEXER_URL}/api/rejections/${hash}`
    );
    assert(result.updateHash === hash, `Expected hash ${hash}, got ${result.updateHash}`);
    assert(result.fiberId === FIBER_A, `Expected fiberId ${FIBER_A}`);
  });

  await test('Includes rawPayload in single-record response', async () => {
    const hash = testRejections[1].rejection.updateHash;
    const result = await fetchJson<RejectionRecord & { rawPayload: unknown }>(
      `${INDEXER_URL}/api/rejections/${hash}`
    );
    assert('rawPayload' in result, 'Missing rawPayload field');
  });

  await test('Returns 404 for unknown updateHash', async () => {
    const response = await fetch(
      `${INDEXER_URL}/api/rejections/nonexistent-hash-0000000000000`
    );
    assert(response.status === 404, `Expected 404, got ${response.status}`);
  });

  await test('Dedup: posting same rejection twice returns 200 with alreadyIndexed=true', async () => {
    const result = await fetchJson<{ accepted: boolean; alreadyIndexed: boolean }>(
      `${INDEXER_URL}/webhook/rejection`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testRejections[0]),
      }
    );
    assert(result.accepted === true, 'Expected accepted=true');
    assert(result.alreadyIndexed === true, 'Expected alreadyIndexed=true (dedup)');
  });

  // ── GET /api/fibers/:fiberId/rejections ───────────────────────────────────
  console.log('\nGET /api/fibers/:fiberId/rejections:');

  await test('Returns rejections for FIBER_A', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${FIBER_A}/rejections`
    );
    assert(result.rejections.length >= 2, `Expected ≥2, got ${result.rejections.length}`);
    assert(typeof result.total === 'number', 'Missing total');
    for (const r of result.rejections) {
      assert(r.fiberId === FIBER_A, `Expected fiberId=${FIBER_A}`);
    }
  });

  await test('Returns rejections for FIBER_B', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${FIBER_B}/rejections`
    );
    assert(result.rejections.length >= 1, `Expected ≥1, got ${result.rejections.length}`);
    for (const r of result.rejections) {
      assert(r.fiberId === FIBER_B, `Expected fiberId=${FIBER_B}`);
    }
  });

  await test('Returns 200 with empty list for unknown fiberId', async () => {
    const result = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/00000000-0000-0000-0000-000000000000/rejections`
    );
    assert(result.total === 0, `Expected total=0, got ${result.total}`);
    assert(result.rejections.length === 0, 'Expected empty rejections');
  });

  await test('Fiber rejections support pagination (limit/offset)', async () => {
    const r1 = await fetchJson<RejectionListResponse>(
      `${INDEXER_URL}/api/fibers/${FIBER_A}/rejections?limit=1&offset=0`
    );
    assert(r1.rejections.length === 1, `Expected 1, got ${r1.rejections.length}`);
    assert(typeof r1.hasMore === 'boolean', 'Missing hasMore');
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  await cleanup();

  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.message}`);
    }
    process.exit(1);
  } else {
    console.log('\n✨ All rejection API tests passed!');
  }
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
