/**
 * OttoChain Bridge - Delegation Routes
 * 
 * API endpoints for creating, managing, and submitting delegated transactions
 */

import express from 'express';
import { z } from 'zod';
import { keyPairFromPrivateKey } from '@ottochain/sdk';

// Temporary type definitions (until SDK types are properly available)
enum DelegationApproach {
  DELEGATION_APPROACH_UNSPECIFIED = 0,
  DELEGATION_APPROACH_SESSION_KEY = 1,
  DELEGATION_APPROACH_SIGNED_INTENT = 2,
}

enum FeePaymentMethod {
  FEE_PAYMENT_METHOD_UNSPECIFIED = 0,
  FEE_PAYMENT_METHOD_RELAYER_PAYS = 1,
  FEE_PAYMENT_METHOD_PRINCIPAL_PAYS = 2,
  FEE_PAYMENT_METHOD_SPONSOR_PAYS = 3,
}

interface DelegationScope {
  fiberIds?: string[];
  allowedOperations?: string[];
  maxGasPerTx?: number;
  maxTotalGas?: number;
  policyRules?: any;
}

interface DelegationAuthority {
  delegationId: string;
  principalAddress: string;
  delegateAddress: string;
  scope: DelegationScope;
  approach: DelegationApproach;
  expiresAt: Date;
  nonce: number;
  principalSignature: string;
  metadata?: { structValue?: Record<string, unknown> };
}

interface RelayedTransaction {
  transaction: { structValue: Record<string, unknown> };
  delegationProof: any;
  gasConfig: any;
  relayerAddress: string;
  relayerSignature: string;
}
import { submitTransaction } from '../metagraph.js';

export const delegationRoutes: express.Router = express.Router();

// =============================================================================
// Basic Delegation Utilities (simplified implementation)
// =============================================================================

/**
 * Create a basic delegation structure
 */
function createBasicDelegation(config: {
  principalAddress: string;
  delegateAddress: string;
  scope: DelegationScope;
  approach: DelegationApproach;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}): DelegationAuthority {
  const delegationId = generateDelegationId(config.principalAddress, config.delegateAddress);
  
  return {
    delegationId,
    principalAddress: config.principalAddress,
    delegateAddress: config.delegateAddress,
    scope: config.scope,
    approach: config.approach,
    expiresAt: config.expiresAt,
    nonce: Date.now(),
    principalSignature: '', // To be filled
    metadata: config.metadata ? { structValue: config.metadata } : undefined,
  };
}

/**
 * Basic delegation validation
 */
function validateDelegation(delegation: DelegationAuthority): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!delegation.delegationId) errors.push('Missing delegation ID');
  if (!delegation.principalAddress) errors.push('Missing principal address');
  if (!delegation.delegateAddress) errors.push('Missing delegate address');
  if (!delegation.expiresAt || delegation.expiresAt <= new Date()) errors.push('Invalid or past expiry');
  if (!delegation.scope) errors.push('Missing delegation scope');

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a unique delegation ID
 */
function generateDelegationId(principalAddress: string, delegateAddress: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2);
  return `del_${principalAddress.substring(0, 8)}_${delegateAddress.substring(0, 8)}_${timestamp}_${random}`;
}

// =============================================================================
// Validation Schemas
// =============================================================================

const DelegationScopeSchema = z.object({
  fiberIds: z.array(z.string()).optional(),
  allowedOperations: z.array(z.string()).optional(),
  maxGasPerTx: z.number().optional(),
  maxTotalGas: z.number().optional(),
  policyRules: z.record(z.unknown()).optional(),
});

const CreateDelegationRequestSchema = z.object({
  delegateAddress: z.string().min(1, 'Delegate address required'),
  scope: DelegationScopeSchema,
  approach: z.number().min(0).max(2), // DelegationApproach enum values
  expiresAt: z.string().datetime('Invalid expiry timestamp'),
  metadata: z.record(z.unknown()).optional(),
  privateKey: z.string().min(1, 'Private key required for signing'),
});

const RevokeDelegationRequestSchema = z.object({
  delegationId: z.string().min(1, 'Delegation ID required'),
  reason: z.string().optional(),
  privateKey: z.string().min(1, 'Private key required for signing'),
});

const RelayedTransactionRequestSchema = z.object({
  transaction: z.record(z.unknown()),
  delegationId: z.string().min(1, 'Delegation ID required'),
  delegationProof: z.object({
    type: z.enum(['sessionKey', 'signedIntent']),
    proof: z.record(z.unknown()),
  }),
  gasConfig: z.object({
    gasLimit: z.number().positive(),
    gasPrice: z.number().optional(),
    paymentMethod: z.number(), // FeePaymentMethod enum value
  }),
  relayerPrivateKey: z.string().min(1, 'Relayer private key required'),
});

// =============================================================================
// In-Memory Storage (for demo - should be replaced with persistent storage)
// =============================================================================

// Store active delegations by ID
const activeDelegations = new Map<string, any>();

// Store revoked delegations by ID
const revokedDelegations = new Set<string>();

// Store delegation usage tracking
const delegationUsage = new Map<string, {
  transactionCount: number;
  totalGasUsed: number;
  lastUsed: Date;
}>();

// =============================================================================
// API Endpoints
// =============================================================================

/**
 * Create a new delegation
 * POST /delegation/create
 */
delegationRoutes.post('/create', async (req, res) => {
  try {
    console.log('[delegation/create] Creating new delegation');
    
    const input = CreateDelegationRequestSchema.parse(req.body);
    
    // Get principal address from private key
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const principalAddress = keyPair.address;
    
    // Create delegation structure
    const delegation = createBasicDelegation({
      principalAddress,
      delegateAddress: input.delegateAddress,
      scope: input.scope as DelegationScope,
      approach: input.approach as DelegationApproach,
      expiresAt: new Date(input.expiresAt as string),
      metadata: input.metadata,
    });
    
    // Basic signing (simplified - in production would use proper crypto)
    delegation.principalSignature = `signed_by_${principalAddress}_at_${Date.now()}`;
    
    // Validate the delegation
    const validation = validateDelegation(delegation);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid delegation',
        details: validation.errors,
      });
    }
    
    const signedDelegation = delegation;
    
    // Store the delegation
    activeDelegations.set(signedDelegation.delegationId, signedDelegation);
    
    // Initialize usage tracking
    delegationUsage.set(signedDelegation.delegationId, {
      transactionCount: 0,
      totalGasUsed: 0,
      lastUsed: new Date(),
    });
    
    console.log(`[delegation/create] Created delegation ${signedDelegation.delegationId}`);
    
    res.json({
      delegationId: signedDelegation.delegationId,
      delegation: signedDelegation,
      message: 'Delegation created successfully',
    });
    
  } catch (error) {
    console.error('[delegation/create] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create delegation';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Health check endpoint
 */
delegationRoutes.get('/health', (_, res) => {
  res.json({ 
    status: 'ok',
    service: 'delegation-bridge',
    activeDelegations: activeDelegations.size,
    revokedDelegations: revokedDelegations.size,
  });
});

/**
 * Get delegation by ID
 * GET /delegation/:delegationId
 */
delegationRoutes.get('/:delegationId', async (req, res) => {
  try {
    const { delegationId } = req.params;
    
    const delegation = activeDelegations.get(delegationId);
    if (!delegation) {
      return res.status(404).json({
        error: 'Delegation not found',
        delegationId,
      });
    }
    
    const usage = delegationUsage.get(delegationId);
    const isRevoked = revokedDelegations.has(delegationId);
    
    res.json({
      delegation,
      usage,
      isRevoked,
      status: isRevoked ? 'revoked' : (new Date() > delegation.expiresAt ? 'expired' : 'active'),
    });
    
  } catch (error) {
    console.error('[delegation/get] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get delegation';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List delegations for an address
 * GET /delegation?principal=<address>&delegate=<address>&status=<active|expired|revoked>
 */
delegationRoutes.get('/', async (req, res) => {
  try {
    const { principal, delegate, status } = req.query;
    
    const delegations = Array.from(activeDelegations.values()).filter(delegation => {
      // Filter by principal address
      if (principal && delegation.principalAddress !== principal) {
        return false;
      }
      
      // Filter by delegate address
      if (delegate && delegation.delegateAddress !== delegate) {
        return false;
      }
      
      // Filter by status
      if (status) {
        const isRevoked = revokedDelegations.has(delegation.delegationId);
        const isExpired = new Date() > delegation.expiresAt;
        const currentStatus = isRevoked ? 'revoked' : (isExpired ? 'expired' : 'active');
        
        if (currentStatus !== status) {
          return false;
        }
      }
      
      return true;
    });
    
    // Add usage information
    const delegationsWithUsage = delegations.map(delegation => ({
      ...delegation,
      usage: delegationUsage.get(delegation.delegationId),
      isRevoked: revokedDelegations.has(delegation.delegationId),
    }));
    
    res.json({
      delegations: delegationsWithUsage,
      total: delegationsWithUsage.length,
    });
    
  } catch (error) {
    console.error('[delegation/list] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to list delegations';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Revoke a delegation
 * DELETE /delegation/:delegationId
 */
delegationRoutes.delete('/:delegationId', async (req, res) => {
  try {
    console.log('[delegation/revoke] Revoking delegation');
    
    const { delegationId } = req.params;
    const input = RevokeDelegationRequestSchema.parse(req.body);
    
    // Check if delegation exists
    const delegation = activeDelegations.get(delegationId);
    if (!delegation) {
      return res.status(404).json({
        error: 'Delegation not found',
        delegationId,
      });
    }
    
    // Verify caller is the principal
    const callerKeyPair = keyPairFromPrivateKey(input.privateKey);
    if (callerKeyPair.address !== delegation.principalAddress) {
      return res.status(403).json({
        error: 'Only the principal can revoke this delegation',
      });
    }
    
    // Check if already revoked
    if (revokedDelegations.has(delegationId)) {
      return res.status(409).json({
        error: 'Delegation already revoked',
        delegationId,
      });
    }
    
    // Create revocation message
    const revocation = {
      delegationId,
      reason: input.reason,
      nonce: Date.now(),
      revocationSignature: `revoked_by_${callerKeyPair.address}_at_${Date.now()}`,
      revokedAt: new Date(),
    };
    
    // Sign the revocation (TODO: implement revocation signing)
    // For now, we'll just mark it as revoked
    
    // Mark as revoked
    revokedDelegations.add(delegationId);
    
    console.log(`[delegation/revoke] Revoked delegation ${delegationId}`);
    
    res.json({
      delegationId,
      revocation,
      message: 'Delegation revoked successfully',
    });
    
  } catch (error) {
    console.error('[delegation/revoke] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to revoke delegation';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Submit a delegated transaction
 * POST /delegation/submit
 */
delegationRoutes.post('/submit', async (req, res) => {
  try {
    console.log('[delegation/submit] Submitting delegated transaction');
    
    const input = RelayedTransactionRequestSchema.parse(req.body);
    
    // Get delegation
    const delegation = activeDelegations.get(input.delegationId);
    if (!delegation) {
      return res.status(404).json({
        error: 'Delegation not found',
        delegationId: input.delegationId,
      });
    }
    
    // Check if delegation is revoked
    if (revokedDelegations.has(input.delegationId)) {
      return res.status(403).json({
        error: 'Delegation has been revoked',
        delegationId: input.delegationId,
      });
    }
    
    // Check if delegation has expired
    if (new Date() > delegation.expiresAt) {
      return res.status(403).json({
        error: 'Delegation has expired',
        delegationId: input.delegationId,
        expiredAt: delegation.expiresAt,
      });
    }
    
    // Validate delegation
    const validation = validateDelegation(delegation);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid delegation',
        details: validation.errors,
      });
    }
    
    // Get relayer address
    const relayerKeyPair = keyPairFromPrivateKey(input.relayerPrivateKey);
    const relayerAddress = relayerKeyPair.address;
    
    // Verify relayer is authorized
    if (relayerAddress !== delegation.delegateAddress) {
      return res.status(403).json({
        error: 'Relayer address does not match delegation',
        expected: delegation.delegateAddress,
        actual: relayerAddress,
      });
    }
    
    // Check delegation scope
    const scopeCheck = await validateTransactionScope(input.transaction, delegation.scope);
    if (!scopeCheck.valid) {
      return res.status(403).json({
        error: 'Transaction violates delegation scope',
        details: scopeCheck.errors,
      });
    }
    
    // Check gas limits
    const usage = delegationUsage.get(input.delegationId)!;
    const gasLimit = input.gasConfig.gasLimit as number;
    
    if (delegation.scope.maxGasPerTx && gasLimit > delegation.scope.maxGasPerTx) {
      return res.status(403).json({
        error: 'Transaction exceeds per-transaction gas limit',
        limit: delegation.scope.maxGasPerTx,
        requested: gasLimit,
      });
    }
    
    if (delegation.scope.maxTotalGas && 
        usage.totalGasUsed + gasLimit > delegation.scope.maxTotalGas) {
      return res.status(403).json({
        error: 'Transaction would exceed total delegation gas limit',
        limit: delegation.scope.maxTotalGas,
        current: usage.totalGasUsed,
        requested: gasLimit,
      });
    }
    
    // Create relayed transaction envelope (simplified)
    const relayedTx = {
      transaction: { structValue: input.transaction },
      delegationProof: input.delegationProof.type === 'sessionKey' 
        ? { $case: 'sessionKeyProof', sessionKeyProof: input.delegationProof.proof }
        : { $case: 'signedIntentProof', signedIntentProof: input.delegationProof.proof },
      gasConfig: input.gasConfig,
      relayerAddress,
      relayerSignature: `relayed_by_${relayerAddress}_at_${Date.now()}`,
    } as RelayedTransaction;
    
    try {
      // Submit transaction to metagraph
      const result = await submitTransaction(input.transaction, input.relayerPrivateKey);
      
      // Update usage tracking
      usage.transactionCount++;
      usage.totalGasUsed += gasLimit;
      usage.lastUsed = new Date();
      
      console.log(`[delegation/submit] Transaction submitted via delegation ${input.delegationId}`);
      
      res.json({
        success: true,
        delegationId: input.delegationId,
        transactionHash: result.hash,
        relayedTx,
        usage,
        message: 'Delegated transaction submitted successfully',
      });
      
    } catch (submitError) {
      console.error('[delegation/submit] Transaction submission failed:', submitError);
      throw submitError;
    }
    
  } catch (error) {
    console.error('[delegation/submit] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to submit delegated transaction';
    res.status(500).json({ error: errorMessage });
  }
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate a transaction against delegation scope
 */
async function validateTransactionScope(
  transaction: Record<string, unknown>, 
  scope: DelegationScope
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Check allowed operations
  if (scope.allowedOperations && scope.allowedOperations.length > 0) {
    const operationType = transaction.type || transaction.operation || transaction.messageType;
    if (!operationType || !scope.allowedOperations.includes(operationType as string)) {
      errors.push(`Operation '${operationType}' not allowed by delegation scope`);
    }
  }
  
  // Check fiber IDs
  if (scope.fiberIds && scope.fiberIds.length > 0) {
    const fiberId = transaction.fiberId || transaction.targetId;
    if (!fiberId || !scope.fiberIds.includes(fiberId as string)) {
      errors.push(`Fiber ID '${fiberId}' not allowed by delegation scope`);
    }
  }
  
  // TODO: Implement JSON Logic policy validation
  if (scope.policyRules) {
    console.warn('JSON Logic policy validation not yet implemented');
    // This would integrate with the JLVM to evaluate policy rules
    // against the transaction and current context
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

console.log('🔄 Delegation routes loaded');