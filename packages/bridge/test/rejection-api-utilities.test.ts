/**
 * Rejection API Utilities — Unit Tests
 * 
 * Tests for the shared rejection checking utilities used by integration tests.
 * These are pure unit tests (no network required).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  validateRejectionApiResponse,
  isValidRejectionErrorCode,
  generateRejectionSummary,
  validateTestEnvironment,
} from './lib/rejection-utils.ts';

describe('Rejection API Utility Functions', () => {

  describe('validateRejectionApiResponse', () => {
    it('returns true for valid response format', () => {
      assert.strictEqual(
        validateRejectionApiResponse({ rejections: [], total: 0 }),
        true,
      );
    });

    it('returns true for response with rejections', () => {
      assert.strictEqual(
        validateRejectionApiResponse({
          rejections: [{ fiberId: 'abc', ordinal: 1, timestamp: '2026-01-01', errors: [] }],
          total: 1,
        }),
        true,
      );
    });

    it('returns false for null', () => {
      assert.strictEqual(validateRejectionApiResponse(null), false);
    });

    it('returns false for missing rejections array', () => {
      assert.strictEqual(validateRejectionApiResponse({ total: 0 }), false);
    });

    it('returns false for missing total', () => {
      assert.strictEqual(validateRejectionApiResponse({ rejections: [] }), false);
    });

    it('returns false for non-array rejections', () => {
      assert.strictEqual(
        validateRejectionApiResponse({ rejections: 'not-array', total: 0 }),
        false,
      );
    });
  });

  describe('isValidRejectionErrorCode', () => {
    const validCodes = [
      'InvalidOwner',
      'ValidationError',
      'InvalidState',
      'ConcurrencyConflict',
      'InsufficientBalance',
      'InvalidTransition',
      'GuardFailed',
      'InvalidSignature',
      'DuplicateTransaction',
      'FiberNotFound',
    ];

    for (const code of validCodes) {
      it(`recognizes "${code}" as valid`, () => {
        assert.strictEqual(isValidRejectionErrorCode(code), true);
      });
    }

    it('rejects unknown error codes', () => {
      assert.strictEqual(isValidRejectionErrorCode('SomethingRandom'), false);
    });

    it('rejects empty string', () => {
      assert.strictEqual(isValidRejectionErrorCode(''), false);
    });
  });

  describe('generateRejectionSummary', () => {
    it('returns zero counts for empty operations', () => {
      const summary = generateRejectionSummary([]);
      assert.strictEqual(summary.totalOperations, 0);
      assert.strictEqual(summary.rejectedOperations, 0);
      assert.strictEqual(summary.rejectionRate, 0);
    });

    it('counts operations correctly', () => {
      const summary = generateRejectionSummary([
        { fiberId: 'a', operation: 'register', rejected: false },
        { fiberId: 'b', operation: 'activate', rejected: false },
        { fiberId: 'c', operation: 'register', rejected: true },
      ]);
      assert.strictEqual(summary.totalOperations, 3);
      assert.strictEqual(summary.rejectedOperations, 1);
      assert.ok(Math.abs(summary.rejectionRate - 1 / 3) < 0.001);
    });

    it('breaks down by operation type', () => {
      const summary = generateRejectionSummary([
        { fiberId: 'a', operation: 'register', rejected: false },
        { fiberId: 'b', operation: 'register', rejected: true },
        { fiberId: 'c', operation: 'activate', rejected: false },
      ]);
      assert.deepStrictEqual(summary.operationBreakdown.register, { total: 2, rejected: 1 });
      assert.deepStrictEqual(summary.operationBreakdown.activate, { total: 1, rejected: 0 });
    });
  });

  describe('validateTestEnvironment', () => {
    it('returns default URLs when env vars not set', () => {
      const env = validateTestEnvironment();
      assert.ok(env.indexerUrl);
      assert.ok(env.bridgeUrl);
      assert.ok(env.ml0Url);
    });
  });
});
