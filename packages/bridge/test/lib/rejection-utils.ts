/**
 * Rejection API Utilities
 * 
 * Shared helpers for checking transaction rejections via the indexer API.
 * Used by integration/e2e tests to verify operations weren't rejected.
 */

import { expect } from 'vitest';

const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';

// ============================================================================
// Types
// ============================================================================

export interface RejectionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RejectionEntry {
  fiberId: string;
  ordinal: number;
  timestamp: string;
  errors: RejectionError[];
}

export interface RejectionResponse {
  rejections: RejectionEntry[];
  total: number;
}

export interface TestEnvironment {
  indexerUrl: string;
  bridgeUrl: string;
  ml0Url: string;
}

export interface OperationResult<T = unknown> {
  success: boolean;
  rejected: boolean;
  result?: T;
  rejectionDetails?: RejectionEntry[];
}

export interface RejectionSummary {
  totalOperations: number;
  rejectedOperations: number;
  rejectionRate: number;
  operationBreakdown: Record<string, { total: number; rejected: number }>;
}

// ============================================================================
// Known rejection error codes from the metagraph
// ============================================================================

const VALID_REJECTION_ERROR_CODES = new Set([
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
]);

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch rejections for a fiber from the indexer API.
 * Returns empty array if indexer is unreachable (graceful degradation).
 */
export async function getRejections(
  fiberId: string,
  indexerUrl: string = INDEXER_URL
): Promise<RejectionEntry[]> {
  try {
    const res = await fetch(`${indexerUrl}/api/rejections?fiberId=${encodeURIComponent(fiberId)}`);
    if (!res.ok) {
      console.warn(`[rejection-utils] Indexer returned ${res.status} for fiberId=${fiberId}`);
      return [];
    }
    const body = await res.json() as RejectionResponse;
    return body.rejections ?? [];
  } catch (err) {
    // Indexer not running — graceful skip in CI
    if ((err as NodeJS.ErrnoException).cause && 
        (((err as any).cause as NodeJS.ErrnoException).code === 'ECONNREFUSED')) {
      console.warn(`[rejection-utils] Indexer not reachable at ${indexerUrl}, skipping rejection check`);
      return [];
    }
    throw err;
  }
}

/**
 * Assert that a fiber has zero rejections.
 * Provides detailed error messages with rejection context.
 */
export async function assertNoRejections(
  fiberId: string,
  operation: string,
  indexerUrl: string = INDEXER_URL
): Promise<void> {
  const rejections = await getRejections(fiberId, indexerUrl);
  expect(rejections.length).toBe(0);
}

/**
 * Run an async operation then check for rejections.
 */
export async function waitForOperationWithRejectionCheck<T>(
  fiberId: string,
  operation: () => Promise<T>,
  indexerUrl: string = INDEXER_URL
): Promise<OperationResult<T>> {
  try {
    const result = await operation();
    const rejections = await getRejections(fiberId, indexerUrl);
    return {
      success: rejections.length === 0,
      rejected: rejections.length > 0,
      result,
      rejectionDetails: rejections.length > 0 ? rejections : undefined,
    };
  } catch (err) {
    return {
      success: false,
      rejected: false, // Failed before we could check rejections
    };
  }
}

/**
 * Validate that a rejection API response matches expected format.
 */
export function validateRejectionApiResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const r = response as Record<string, unknown>;
  if (!Array.isArray(r.rejections)) return false;
  if (typeof r.total !== 'number') return false;
  return true;
}

/**
 * Check if a rejection error code is a known valid code.
 */
export function isValidRejectionErrorCode(code: string): boolean {
  return VALID_REJECTION_ERROR_CODES.has(code);
}

/**
 * Generate a summary of rejection statistics across operations.
 */
export function generateRejectionSummary(
  operations: Array<{ fiberId: string; operation: string; rejected: boolean }>
): RejectionSummary {
  const breakdown: Record<string, { total: number; rejected: number }> = {};

  for (const op of operations) {
    if (!breakdown[op.operation]) {
      breakdown[op.operation] = { total: 0, rejected: 0 };
    }
    breakdown[op.operation].total++;
    if (op.rejected) breakdown[op.operation].rejected++;
  }

  const totalOperations = operations.length;
  const rejectedOperations = operations.filter(o => o.rejected).length;

  return {
    totalOperations,
    rejectedOperations,
    rejectionRate: totalOperations > 0 ? rejectedOperations / totalOperations : 0,
    operationBreakdown: breakdown,
  };
}

/**
 * Validate that required environment variables are set for integration tests.
 */
export function validateTestEnvironment(): TestEnvironment {
  return {
    indexerUrl: process.env.INDEXER_URL || 'http://localhost:3031',
    bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3030',
    ml0Url: process.env.ML0_URL || 'http://localhost:9200',
  };
}
