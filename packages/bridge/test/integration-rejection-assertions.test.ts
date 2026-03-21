/**
 * Integration Rejection Assertions
 * 
 * Verifies that the rejection checking utilities work correctly and
 * integration test files have the required rejection patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getRejections,
  assertNoRejections,
  waitForOperationWithRejectionCheck,
  validateRejectionApiResponse,
  isValidRejectionErrorCode,
  generateRejectionSummary,
  validateTestEnvironment,
} from './lib/rejection-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Rejection Utilities Integration', () => {

  describe('getRejections', () => {
    it('returns empty array when indexer is not running', async () => {
      const rejections = await getRejections('test-fiber-id', 'http://localhost:19999');
      assert.ok(Array.isArray(rejections), 'Should return array');
      assert.strictEqual(rejections.length, 0, 'Should be empty when indexer unavailable');
    });

    it('accepts custom indexer URL', async () => {
      const rejections = await getRejections('any-fiber', 'http://localhost:19999');
      assert.ok(Array.isArray(rejections));
    });
  });

  describe('assertNoRejections', () => {
    it('passes when indexer is not running (graceful)', async () => {
      await assertNoRejections('test-fiber', 'test-operation', 'http://localhost:19999');
    });
  });

  describe('waitForOperationWithRejectionCheck', () => {
    it('returns success when operation succeeds and no rejections', async () => {
      const result = await waitForOperationWithRejectionCheck(
        'test-fiber',
        async () => 'ok',
        'http://localhost:19999',
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rejected, false);
      assert.strictEqual(result.result, 'ok');
    });

    it('returns failure when operation throws', async () => {
      const result = await waitForOperationWithRejectionCheck(
        'test-fiber',
        async () => { throw new Error('boom'); },
        'http://localhost:19999',
      );
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.rejected, false);
    });
  });
});

describe('Integration Test Pattern Verification', () => {

  describe('Bridge E2E test file', () => {
    const e2ePath = join(__dirname, 'e2e.test.ts');
    let content: string;

    try {
      content = readFileSync(e2ePath, 'utf8');
    } catch {
      content = '';
    }

    it('exists', () => {
      assert.ok(content.length > 0, 'e2e.test.ts should exist');
    });

    it('imports rejection utilities', () => {
      assert.ok(
        content.includes('getRejections') || content.includes('assertNoRejections'),
        'e2e.test.ts should import rejection checking utilities',
      );
    });

    it('has rejection assertions after operations', () => {
      const rejectionChecks = (content.match(/rejections/g) || []).length;
      assert.ok(
        rejectionChecks >= 2,
        `e2e.test.ts should have rejection assertions (found ${rejectionChecks} references)`,
      );
    });
  });

  describe('Traffic-gen integration test file', () => {
    const integPath = join(__dirname, '../../traffic-generator/test/integration.test.ts');
    let content: string;

    try {
      content = readFileSync(integPath, 'utf8');
    } catch {
      content = '';
    }

    it('exists', () => {
      assert.ok(content.length > 0, 'integration.test.ts should exist');
    });

    it('imports rejection utilities', () => {
      assert.ok(
        content.includes('getRejections') || content.includes('assertNoRejections'),
        'integration.test.ts should import rejection checking utilities',
      );
    });

    it('has rejection assertions after operations', () => {
      const rejectionChecks = (content.match(/rejections/g) || []).length;
      assert.ok(
        rejectionChecks >= 2,
        `integration.test.ts should have rejection assertions (found ${rejectionChecks} references)`,
      );
    });
  });
});
