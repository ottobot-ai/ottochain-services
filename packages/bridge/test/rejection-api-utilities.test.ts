/**
 * Rejection API Utilities — Unit Tests
 * 
 * Tests for the shared rejection checking utilities used by integration tests.
 * These are pure unit tests (no network required).
 */

import { describe, it, expect } from 'vitest';

import {
  validateRejectionApiResponse,
  isValidRejectionErrorCode,
  generateRejectionSummary,
  validateTestEnvironment,
} from './lib/rejection-utils.ts';

describe('Rejection API Utility Functions', () => {

  describe('validateRejectionApiResponse', () => {
    it('returns true for valid response format', () => {
      expect(
        validateRejectionApiResponse({ rejections: [], total: 0 }),
      ).toBe(true);
    });

    it('returns true for response with rejections', () => {
      expect(
        validateRejectionApiResponse({
          rejections: [{ fiberId: 'abc', ordinal: 1, timestamp: '2026-01-01', errors: [] }],
          total: 1,
        }),
      ).toBe(true);
    });

    it('returns false for null', () => {
      expect(validateRejectionApiResponse(null)).toBe(false);
    });

    it('returns false for missing rejections array', () => {
      expect(validateRejectionApiResponse({ total: 0 })).toBe(false);
    });

    it('returns false for missing total', () => {
      expect(validateRejectionApiResponse({ rejections: [] })).toBe(false);
    });

    it('returns false for non-array rejections', () => {
      expect(
        validateRejectionApiResponse({ rejections: 'not-array', total: 0 }),
      ).toBe(false);
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
        expect(isValidRejectionErrorCode(code)).toBe(true);
      });
    }

    it('rejects unknown error codes', () => {
      expect(isValidRejectionErrorCode('SomethingRandom')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidRejectionErrorCode('')).toBe(false);
    });
  });

  describe('generateRejectionSummary', () => {
    it('returns zero counts for empty operations', () => {
      const summary = generateRejectionSummary([]);
      expect(summary.totalOperations).toBe(0);
      expect(summary.rejectedOperations).toBe(0);
      expect(summary.rejectionRate).toBe(0);
    });

    it('counts operations correctly', () => {
      const summary = generateRejectionSummary([
        { fiberId: 'a', operation: 'register', rejected: false },
        { fiberId: 'b', operation: 'activate', rejected: false },
        { fiberId: 'c', operation: 'register', rejected: true },
      ]);
      expect(summary.totalOperations).toBe(3);
      expect(summary.rejectedOperations).toBe(1);
      expect(Math.abs(summary.rejectionRate - 1 / 3) < 0.001).toBe(true);
    });

    it('breaks down by operation type', () => {
      const summary = generateRejectionSummary([
        { fiberId: 'a', operation: 'register', rejected: false },
        { fiberId: 'b', operation: 'register', rejected: true },
        { fiberId: 'c', operation: 'activate', rejected: false },
      ]);
      expect(summary.operationBreakdown.register).toEqual({ total: 2, rejected: 1 });
      expect(summary.operationBreakdown.activate).toEqual({ total: 1, rejected: 0 });
    });
  });

  describe('validateTestEnvironment', () => {
    it('returns default URLs when env vars not set', () => {
      const env = validateTestEnvironment();
      expect(env.indexerUrl).toBeTruthy();
      expect(env.bridgeUrl).toBeTruthy();
      expect(env.ml0Url).toBeTruthy();
    });
  });
});
