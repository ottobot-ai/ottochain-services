// Delegation management routes
// Supports the delegated signing pattern: users grant session keys to agents/relayers

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  submitTransaction,
  getStateMachine,
  keyPairFromPrivateKey,
  getFiberSequenceNumber,
} from '../metagraph.js';
import type { FiberOrdinal } from '../metagraph.js';
// Delegation status constants — mirrors the proto-generated enum in SDK PR #41
// TODO: replace with @ottochain/sdk/delegation import once that PR merges
const DelegationStatus = {
  UNSPECIFIED: 'DELEGATION_STATUS_UNSPECIFIED',
  ACTIVE: 'DELEGATION_STATUS_ACTIVE',
  EXPIRED: 'DELEGATION_STATUS_EXPIRED',
  REVOKED: 'DELEGATION_STATUS_REVOKED',
  SUSPENDED: 'DELEGATION_STATUS_SUSPENDED',
} as const;

function parseDelegationStatus(value: string): string {
  // Accept both string enum form and numeric form
  const map: Record<string, string> = {
    '0': DelegationStatus.UNSPECIFIED,
    '1': DelegationStatus.ACTIVE,
    '2': DelegationStatus.EXPIRED,
    '3': DelegationStatus.REVOKED,
    '4': DelegationStatus.SUSPENDED,
    DELEGATION_STATUS_UNSPECIFIED: DelegationStatus.UNSPECIFIED,
    DELEGATION_STATUS_ACTIVE: DelegationStatus.ACTIVE,
    DELEGATION_STATUS_EXPIRED: DelegationStatus.EXPIRED,
    DELEGATION_STATUS_REVOKED: DelegationStatus.REVOKED,
    DELEGATION_STATUS_SUSPENDED: DelegationStatus.SUSPENDED,
    // Also accept short forms for convenience
    UNSPECIFIED: DelegationStatus.UNSPECIFIED,
    ACTIVE: DelegationStatus.ACTIVE,
    EXPIRED: DelegationStatus.EXPIRED,
    REVOKED: DelegationStatus.REVOKED,
    SUSPENDED: DelegationStatus.SUSPENDED,
  };
  return map[value] ?? DelegationStatus.UNSPECIFIED;
}

export const delegationRoutes: RouterType = Router();

// ============================================================================
// Constants
// ============================================================================

/** Maximum delegation lifetime in hours (24h per proto spec) */
const MAX_DELEGATION_HOURS = 24;

// ============================================================================
// Request Schemas
// ============================================================================

const DelegationScopeSchema = z.object({
  allowedOperations: z.array(z.string()).default([]),
  allowedContracts: z.array(z.string()).default([]),
  maxTransactionAmount: z.string().optional(),
  maxTotalAmount: z.string().optional(),
  minReputationScore: z.number().optional(),
});

const CreateDelegationSchema = z.object({
  /** Private key of the user granting delegation (signs the delegation record) */
  userPrivateKey: z.string().length(64),
  /** Address of the delegate (agent/relayer) that will receive authority */
  delegateAddress: z.string().min(1),
  /** Operations and spending limits granted to the delegate */
  scope: DelegationScopeSchema,
  /** Lifetime of delegation in hours (1–24). Defaults to 24. */
  expiryHours: z.number().min(1).max(MAX_DELEGATION_HOURS).default(MAX_DELEGATION_HOURS),
});

const RevokeDelegationSchema = z.object({
  /** Private key of the original delegator (must match delegatorAddress) */
  userPrivateKey: z.string().length(64),
  /** ID of the delegation to revoke */
  delegationId: z.string().uuid(),
  /** Human-readable reason for revocation */
  reason: z.string().optional(),
  /** Replay-protection nonce */
  nonce: z.number().int().nonnegative().default(0),
});

/**
 * Schema for a delegation proof included in a submit request.
 * This is the on-chain delegation record returned from /delegation/create.
 */
const DelegationProofSchema = z.object({
  delegationId: z.string().uuid(),
  delegatorAddress: z.string().min(1),
  delegateAddress: z.string().min(1),
  sessionKeyId: z.string().min(1),
  scope: DelegationScopeSchema,
  expiresAt: z.string().datetime(),
  status: z.string(),
  nonce: z.number().int().nonnegative(),
  userSignature: z.string().min(1),
});

const SubmitDelegatedTransactionSchema = z.object({
  /** Full delegation proof returned from /delegation/create */
  delegation: DelegationProofSchema,
  /**
   * The transaction payload to execute on behalf of the delegator.
   * The relayer/agent must have already computed sessionSignature.
   */
  transaction: z.object({
    /** Operation name (must be in delegation.scope.allowedOperations) */
    operation: z.string().min(1),
    /** Target address or contract identifier */
    target: z.string().min(1),
    /** Serialised transaction payload (base64) */
    payload: z.string().min(1),
    /** Signature over the transaction by the session key */
    sessionSignature: z.string().min(1),
    /** Per-transaction nonce for replay protection */
    transactionNonce: z.number().int().nonnegative(),
    /** Optional amount being spent/transferred */
    amount: z.string().optional(),
  }),
  /** Private key of the session key (used to sign the outer submission) */
  sessionKeyPrivateKey: z.string().length(64),
});

// ============================================================================
// Validation Helpers
// ============================================================================

interface DelegationValidationError {
  errorType: string;
  errorMessage: string;
  fieldPath: string;
}

function validateDelegationProof(
  delegation: z.infer<typeof DelegationProofSchema>,
  operation: string,
  amount?: string,
): DelegationValidationError[] {
  const errors: DelegationValidationError[] = [];

  // ── Status check ──────────────────────────────────────────────────────────
  const status = parseDelegationStatus(delegation.status);
  if (status === DelegationStatus.EXPIRED) {
    errors.push({
      errorType: 'DELEGATION_VALIDATION_ERROR_DELEGATION_EXPIRED',
      errorMessage: 'Delegation has expired',
      fieldPath: 'delegation.status',
    });
    return errors; // No point checking further
  }
  if (status === DelegationStatus.REVOKED) {
    errors.push({
      errorType: 'DELEGATION_VALIDATION_ERROR_DELEGATION_REVOKED',
      errorMessage: 'Delegation has been revoked',
      fieldPath: 'delegation.status',
    });
    return errors;
  }
  if (status === DelegationStatus.SUSPENDED) {
    errors.push({
      errorType: 'DELEGATION_VALIDATION_ERROR_DELEGATION_NOT_FOUND',
      errorMessage: `Delegation is suspended`,
      fieldPath: 'delegation.status',
    });
    return errors;
  }

  // ── Expiry check ──────────────────────────────────────────────────────────
  const now = Date.now();
  const expiresAt = new Date(delegation.expiresAt).getTime();
  if (expiresAt <= now) {
    errors.push({
      errorType: 'DELEGATION_VALIDATION_ERROR_DELEGATION_EXPIRED',
      errorMessage: `Delegation expired at ${delegation.expiresAt}`,
      fieldPath: 'delegation.expiresAt',
    });
    return errors;
  }

  // ── Scope checks ──────────────────────────────────────────────────────────
  const { scope } = delegation;

  // Operation allowed?
  if (scope.allowedOperations.length > 0 && !scope.allowedOperations.includes(operation)) {
    errors.push({
      errorType: 'DELEGATION_VALIDATION_ERROR_SCOPE_VIOLATION',
      errorMessage: `Operation '${operation}' is not in the allowed operations: [${scope.allowedOperations.join(', ')}]`,
      fieldPath: 'transaction.operation',
    });
  }

  // Per-transaction spending limit
  if (amount !== undefined && scope.maxTransactionAmount !== undefined) {
    const amountNum = BigInt(amount);
    const limitNum = BigInt(scope.maxTransactionAmount);
    if (amountNum > limitNum) {
      errors.push({
        errorType: 'DELEGATION_VALIDATION_ERROR_SPENDING_LIMIT_EXCEEDED',
        errorMessage: `Transaction amount ${amount} exceeds maxTransactionAmount ${scope.maxTransactionAmount}`,
        fieldPath: 'transaction.amount',
      });
    }
  }

  return errors;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Create a new delegation (register on-chain)
 * POST /delegation/create
 *
 * The user grants a delegate (agent/relayer) authority to act within the
 * defined scope and time window.  Returns the delegation ID and session key
 * that the delegate must use when calling /delegation/submit.
 */
delegationRoutes.post('/create', async (req, res) => {
  try {
    const input = CreateDelegationSchema.parse(req.body);

    const userKeyPair = keyPairFromPrivateKey(input.userPrivateKey);
    const delegatorAddress = userKeyPair.address;

    const delegationId = randomUUID();
    const sessionKeyId = randomUUID();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiryHours * 60 * 60 * 1000);

    // Sequence number for this delegation fiber
    const ordinal: FiberOrdinal = await getFiberSequenceNumber(delegationId);

    const message = {
      CreateDelegation: {
        fiberId: delegationId,
        delegationId,
        delegatorAddress,
        delegateAddress: input.delegateAddress,
        sessionKeyId,
        scope: input.scope,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ordinal,
      },
    };

    const result = await submitTransaction(message, input.userPrivateKey);

    res.status(201).json({
      delegationId,
      sessionKeyId,
      delegatorAddress,
      delegateAddress: input.delegateAddress,
      scope: input.scope,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      txHash: result.hash,
      ordinal: result.ordinal,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.errors,
      });
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to create delegation';
    console.error('[delegation] create error:', err);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Submit a delegated transaction
 * POST /delegation/submit
 *
 * A relayer/agent submits a transaction on behalf of the original delegator.
 * The bridge validates the delegation proof (expiry, status, scope) and
 * forwards the signed payload to the metagraph.
 *
 * Error responses:
 * - 400  Invalid request body / missing fields
 * - 422  Delegation validation failed (expired, revoked, scope violation)
 * - 500  Metagraph submission error
 */
delegationRoutes.post('/submit', async (req, res) => {
  try {
    const input = SubmitDelegatedTransactionSchema.parse(req.body);

    const { delegation, transaction, sessionKeyPrivateKey } = input;

    // ── Local validation ───────────────────────────────────────────────────
    const validationErrors = validateDelegationProof(
      delegation,
      transaction.operation,
      transaction.amount,
    );

    if (validationErrors.length > 0) {
      return res.status(422).json({
        error: 'Delegation validation failed',
        validationErrors,
      });
    }

    // ── Derive session key address (for logging / audit) ───────────────────
    const sessionKeyPair = keyPairFromPrivateKey(sessionKeyPrivateKey);

    // ── Sequence number for this delegation fiber ──────────────────────────
    const ordinal: FiberOrdinal = await getFiberSequenceNumber(delegation.delegationId);

    // ── Build metagraph message ────────────────────────────────────────────
    // The metagraph validates the full delegation proof and the session
    // signature before applying the embedded transaction.
    const message = {
      SubmitDelegatedTransaction: {
        delegationId: delegation.delegationId,
        delegatorAddress: delegation.delegatorAddress,
        delegateAddress: delegation.delegateAddress,
        sessionKeyId: delegation.sessionKeyId,
        relayerAddress: sessionKeyPair.address,
        operation: transaction.operation,
        target: transaction.target,
        payload: transaction.payload,
        sessionSignature: transaction.sessionSignature,
        userSignature: delegation.userSignature,
        transactionNonce: transaction.transactionNonce,
        amount: transaction.amount,
        submittedAt: new Date().toISOString(),
        ordinal,
      },
    };

    // ── Submit to metagraph (signed by session key) ────────────────────────
    const result = await submitTransaction(message, sessionKeyPrivateKey);

    res.json({
      success: true,
      delegationId: delegation.delegationId,
      txHash: result.hash,
      ordinal: result.ordinal,
      acceptedBy: result.acceptedBy,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.errors,
      });
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to submit delegated transaction';
    console.error('[delegation] submit error:', err);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Revoke a delegation
 * POST /delegation/revoke
 *
 * The original delegator revokes a previously granted delegation.
 * After revocation any further /delegation/submit calls for this delegation
 * will be rejected with DELEGATION_STATUS_REVOKED (422).
 */
delegationRoutes.post('/revoke', async (req, res) => {
  try {
    const input = RevokeDelegationSchema.parse(req.body);

    const userKeyPair = keyPairFromPrivateKey(input.userPrivateKey);
    const userAddress = userKeyPair.address;

    // Sequence number for the delegation fiber
    const ordinal: FiberOrdinal = await getFiberSequenceNumber(input.delegationId);

    const message = {
      RevokeDelegation: {
        fiberId: input.delegationId,
        delegationId: input.delegationId,
        userAddress,
        reason: input.reason ?? '',
        nonce: input.nonce,
        revokedAt: new Date().toISOString(),
        ordinal,
      },
    };

    const result = await submitTransaction(message, input.userPrivateKey);

    res.json({
      success: true,
      delegationId: input.delegationId,
      revokedBy: userAddress,
      txHash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.errors,
      });
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to revoke delegation';
    console.error('[delegation] revoke error:', err);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get delegation details
 * GET /delegation/:delegationId
 *
 * Returns the current on-chain state of the delegation, including its
 * status, scope, and expiry.
 */
delegationRoutes.get('/:delegationId', async (req, res) => {
  try {
    const { delegationId } = req.params;

    if (!delegationId?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return res.status(400).json({ error: 'Invalid delegationId format (expected UUID)' });
    }

    const state = await getStateMachine(delegationId);

    if (!state) {
      return res.status(404).json({ error: `Delegation ${delegationId} not found` });
    }

    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to retrieve delegation';
    console.error('[delegation] get error:', err);
    res.status(500).json({ error: errorMessage });
  }
});
