/**
 * Integration Rejection Assertions
 * 
 * Verifies that the rejection checking utilities work correctly and
 * integration test files have the required rejection patterns.
 */

import { describe, it, expect } from 'vitest';
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
      expect(Array.isArray(rejections)).toBe(true);
      expect(rejections.length).toBe(0);
    });

    it('accepts custom indexer URL', async () => {
      const rejections = await getRejections('any-fiber', 'http://localhost:19999');
      expect(Array.isArray(rejections)).toBe(true);
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
      expect(result.success).toBe(true);
      expect(result.rejected).toBe(false);
      expect(result.result).toBe('ok');
    });

    it('returns failure when operation throws', async () => {
      const result = await waitForOperationWithRejectionCheck(
        'test-fiber',
        async () => { throw new Error('boom'); },
        'http://localhost:19999',
      );
      expect(result.success).toBe(false);
      expect(result.rejected).toBe(false);
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
      expect(content.length > 0).toBe(true);
    });

    it('imports rejection utilities', () => {
      expect(
        content.includes('getRejections') || content.includes('assertNoRejections'),
      ).toBe(true);
    });

    it('has rejection assertions after operations', () => {
      const rejectionChecks = (content.match(/rejections/g) || []).length;
      expect(rejectionChecks >= 2).toBe(true);
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
      expect(content.length > 0).toBe(true);
    });

    it('imports rejection utilities', () => {
      expect(
        content.includes('getRejections') || content.includes('assertNoRejections'),
      ).toBe(true);
    });

    it('has rejection assertions after operations', () => {
      const rejectionChecks = (content.match(/rejections/g) || []).length;
      expect(rejectionChecks >= 2).toBe(true);
    });
  });
});
