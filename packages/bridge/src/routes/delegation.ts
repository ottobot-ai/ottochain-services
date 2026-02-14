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
  isEmergency: z.boolean().default(false),
});

const DegradePermissionsRequestSchema = z.object({
  delegationId: z.string().min(1, 'Delegation ID required'),
  newScope: DelegationScopeSchema,
  reason: z.string().min(1, 'Degradation reason required'),
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

// Enhanced revocation tracking
const revokedDelegations = new Map<string, {
  delegationId: string;
  revokedAt: Date;
  reason: string;
  revokedBy: string;
  isEmergency: boolean;
  revocationSignature: string;
  nonce: number;
}>();

// Track emergency revocation requests
const emergencyRevocations = new Set<string>();

// Track degraded permissions for delegations
const degradedDelegations = new Map<string, {
  originalScope: DelegationScope;
  currentScope: DelegationScope;
  degradationStarted: Date;
  degradationSteps: Array<{
    step: number;
    timestamp: Date;
    reason: string;
    newScope: DelegationScope;
  }>;
}>();

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
    
    // Create enhanced revocation message
    const revocation = {
      delegationId,
      revokedAt: new Date(),
      reason: input.reason || (input.isEmergency ? 'Emergency revocation' : 'User-initiated revocation'),
      revokedBy: callerKeyPair.address,
      isEmergency: input.isEmergency || false,
      revocationSignature: `revoked_by_${callerKeyPair.address}_at_${Date.now()}`,
      nonce: Date.now(),
    };
    
    // Handle emergency revocation
    if (input.isEmergency) {
      console.log(`[delegation/revoke] EMERGENCY revocation for ${delegationId}`);
      emergencyRevocations.add(delegationId);
      
      // TODO: Trigger immediate propagation to all validators
      // This would involve sending immediate notification to the metagraph
      await handleEmergencyRevocation(delegationId, revocation);
    }
    
    // Store enhanced revocation data
    revokedDelegations.set(delegationId, revocation);
    
    // Clear any degradation tracking for this delegation
    degradedDelegations.delete(delegationId);
    
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
    
    // Enhanced revocation checking (includes emergency revocations)
    if (isRevoked(input.delegationId, true)) {
      const revocationData = revokedDelegations.get(input.delegationId);
      const isEmergency = emergencyRevocations.has(input.delegationId);
      
      return res.status(403).json({
        error: 'Delegation has been revoked',
        delegationId: input.delegationId,
        revocationData,
        isEmergencyRevocation: isEmergency,
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
    
    // Check delegation scope (using effective scope considering degradations)
    const effectiveScope = getEffectiveScope(input.delegationId);
    if (!effectiveScope) {
      return res.status(404).json({
        error: 'Cannot determine effective delegation scope',
        delegationId: input.delegationId,
      });
    }
    
    const scopeCheck = await validateTransactionScope(input.transaction, effectiveScope);
    if (!scopeCheck.valid) {
      const degradation = degradedDelegations.get(input.delegationId);
      return res.status(403).json({
        error: 'Transaction violates delegation scope',
        details: scopeCheck.errors,
        effectiveScope,
        isDegraded: !!degradation,
        degradationInfo: degradation,
      });
    }
    
    // Check gas limits using effective scope
    const usage = delegationUsage.get(input.delegationId)!;
    const gasLimit = input.gasConfig.gasLimit as number;
    
    if (effectiveScope.maxGasPerTx && gasLimit > effectiveScope.maxGasPerTx) {
      return res.status(403).json({
        error: 'Transaction exceeds per-transaction gas limit',
        limit: effectiveScope.maxGasPerTx,
        requested: gasLimit,
        note: 'Limit may be reduced due to delegation degradation',
      });
    }
    
    if (effectiveScope.maxTotalGas && 
        usage.totalGasUsed + gasLimit > effectiveScope.maxTotalGas) {
      return res.status(403).json({
        error: 'Transaction would exceed total delegation gas limit',
        limit: effectiveScope.maxTotalGas,
        current: usage.totalGasUsed,
        requested: gasLimit,
        note: 'Limit may be reduced due to delegation degradation',
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

/**
 * Emergency revoke a delegation (bypasses normal consensus delays)
 * POST /delegation/emergency-revoke
 */
delegationRoutes.post('/emergency-revoke', async (req, res) => {
  try {
    console.log('[delegation/emergency-revoke] Processing emergency revocation');
    
    const input = RevokeDelegationRequestSchema.parse(req.body);
    
    // Validation is the same but we enforce emergency=true
    const enhancedInput = { ...input, isEmergency: true };
    
    // Delegate to the regular revoke endpoint but with emergency flag
    req.body = enhancedInput;
    
    // For emergency revocations, we also implement immediate propagation
    const delegation = activeDelegations.get(input.delegationId);
    if (delegation) {
      const keyPair = keyPairFromPrivateKey(input.privateKey);
      
      // Create immediate revocation entry
      const emergencyRevocation = {
        delegationId: input.delegationId,
        revokedAt: new Date(),
        reason: input.reason || 'Emergency revocation - security incident',
        revokedBy: keyPair.address,
        isEmergency: true,
        revocationSignature: `emergency_revoked_by_${keyPair.address}_at_${Date.now()}`,
        nonce: Date.now(),
      };
      
      // Store immediately
      revokedDelegations.set(input.delegationId, emergencyRevocation);
      emergencyRevocations.add(input.delegationId);
      
      console.log(`[delegation/emergency-revoke] Emergency revocation processed for ${input.delegationId}`);
      
      res.json({
        delegationId: input.delegationId,
        revocation: emergencyRevocation,
        message: 'Emergency revocation processed immediately',
        propagated: true,
      });
    } else {
      res.status(404).json({
        error: 'Delegation not found',
        delegationId: input.delegationId,
      });
    }
    
  } catch (error) {
    console.error('[delegation/emergency-revoke] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to emergency revoke delegation';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Degrade delegation permissions (progressive security)
 * POST /delegation/degrade
 */
delegationRoutes.post('/degrade', async (req, res) => {
  try {
    console.log('[delegation/degrade] Degrading delegation permissions');
    
    const input = DegradePermissionsRequestSchema.parse(req.body);
    
    const delegation = activeDelegations.get(input.delegationId);
    if (!delegation) {
      return res.status(404).json({
        error: 'Delegation not found',
        delegationId: input.delegationId,
      });
    }
    
    // Verify caller is the principal
    const callerKeyPair = keyPairFromPrivateKey(input.privateKey);
    if (callerKeyPair.address !== delegation.principalAddress) {
      return res.status(403).json({
        error: 'Only the principal can degrade this delegation',
      });
    }
    
    // Check if already revoked
    if (revokedDelegations.has(input.delegationId)) {
      return res.status(409).json({
        error: 'Cannot degrade revoked delegation',
        delegationId: input.delegationId,
      });
    }
    
    // Get or create degradation tracking
    let degradationData = degradedDelegations.get(input.delegationId);
    if (!degradationData) {
      degradationData = {
        originalScope: { ...delegation.scope },
        currentScope: { ...delegation.scope },
        degradationStarted: new Date(),
        degradationSteps: [],
      };
    }
    
    // Validate that new scope is actually more restrictive
    const isMoreRestrictive = validateScopeRestriction(degradationData.currentScope, input.newScope);
    if (!isMoreRestrictive) {
      return res.status(400).json({
        error: 'New scope must be more restrictive than current scope',
      });
    }
    
    // Add degradation step
    const step = degradationData.degradationSteps.length + 1;
    degradationData.degradationSteps.push({
      step,
      timestamp: new Date(),
      reason: input.reason,
      newScope: { ...input.newScope },
    });
    
    // Update current scope
    degradationData.currentScope = { ...input.newScope };
    
    // Update the delegation with new scope
    delegation.scope = { ...input.newScope };
    
    // Store degradation data
    degradedDelegations.set(input.delegationId, degradationData);
    
    console.log(`[delegation/degrade] Degraded delegation ${input.delegationId} (step ${step})`);
    
    res.json({
      delegationId: input.delegationId,
      step,
      degradationData,
      updatedDelegation: delegation,
      message: `Delegation permissions degraded (step ${step})`,
    });
    
  } catch (error) {
    console.error('[delegation/degrade] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to degrade delegation';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get revocation status and history
 * GET /delegation/:delegationId/revocations
 */
delegationRoutes.get('/:delegationId/revocations', async (req, res) => {
  try {
    const { delegationId } = req.params;
    
    const revocation = revokedDelegations.get(delegationId);
    const degradation = degradedDelegations.get(delegationId);
    const isEmergency = emergencyRevocations.has(delegationId);
    
    if (!revocation && !degradation) {
      return res.json({
        delegationId,
        isRevoked: false,
        isDegraded: false,
        revocation: null,
        degradation: null,
        emergencyStatus: false,
      });
    }
    
    res.json({
      delegationId,
      isRevoked: !!revocation,
      isDegraded: !!degradation,
      revocation,
      degradation,
      emergencyStatus: isEmergency,
    });
    
  } catch (error) {
    console.error('[delegation/revocations] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get revocation status';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get system-wide revocation statistics
 * GET /delegation/stats/revocations
 */
delegationRoutes.get('/stats/revocations', async (req, res) => {
  try {
    const totalRevocations = revokedDelegations.size;
    const emergencyRevocationCount = emergencyRevocations.size;
    const degradedCount = degradedDelegations.size;
    
    // Calculate revocation reasons breakdown
    const reasonBreakdown: Record<string, number> = {};
    for (const revocation of revokedDelegations.values()) {
      const reason = revocation.reason || 'unspecified';
      reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + 1;
    }
    
    // Calculate recent revocations (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRevocations = Array.from(revokedDelegations.values())
      .filter(r => r.revokedAt > oneDayAgo).length;
    
    res.json({
      statistics: {
        totalRevocations,
        emergencyRevocations: emergencyRevocationCount,
        degradedDelegations: degradedCount,
        recentRevocations,
        reasonBreakdown,
      },
      lastUpdated: new Date(),
    });
    
  } catch (error) {
    console.error('[delegation/stats] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get revocation statistics';
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

/**
 * Handle emergency revocation propagation
 * This would integrate with the metagraph to immediately propagate revocation
 */
async function handleEmergencyRevocation(
  delegationId: string,
  revocation: any
): Promise<void> {
  console.log(`[handleEmergencyRevocation] Processing emergency revocation for ${delegationId}`);
  
  // TODO: Implement immediate metagraph notification
  // This would send a high-priority message to all validators
  // to immediately update their revocation lists
  
  // For now, we'll simulate this with a console log
  console.log(`[handleEmergencyRevocation] Emergency revocation propagated for ${delegationId}`);
  
  // In a real implementation, this might:
  // 1. Send immediate WebSocket notifications to all connected validators
  // 2. Submit a high-priority transaction to the metagraph
  // 3. Update external revocation registries
  // 4. Trigger alerts in monitoring systems
}

/**
 * Validate that a new scope is more restrictive than the current scope
 */
function validateScopeRestriction(
  currentScope: DelegationScope,
  newScope: DelegationScope
): boolean {
  // Check allowed operations - new scope should have fewer or same operations
  if (currentScope.allowedOperations && newScope.allowedOperations) {
    const hasFewerOperations = newScope.allowedOperations.every(op => 
      currentScope.allowedOperations!.includes(op)
    ) && newScope.allowedOperations.length <= currentScope.allowedOperations.length;
    
    if (!hasFewerOperations) return false;
  } else if (currentScope.allowedOperations && !newScope.allowedOperations) {
    // Removing operation restrictions entirely is not more restrictive
    return false;
  }
  
  // Check fiber IDs - new scope should have fewer or same fibers
  if (currentScope.fiberIds && newScope.fiberIds) {
    const hasFewerFibers = newScope.fiberIds.every(id => 
      currentScope.fiberIds!.includes(id)
    ) && newScope.fiberIds.length <= currentScope.fiberIds.length;
    
    if (!hasFewerFibers) return false;
  } else if (currentScope.fiberIds && !newScope.fiberIds) {
    // Removing fiber restrictions entirely is not more restrictive
    return false;
  }
  
  // Check gas limits - new scope should have lower or same limits
  if (currentScope.maxGasPerTx !== undefined) {
    if (newScope.maxGasPerTx === undefined || newScope.maxGasPerTx > currentScope.maxGasPerTx) {
      return false;
    }
  }
  
  if (currentScope.maxTotalGas !== undefined) {
    if (newScope.maxTotalGas === undefined || newScope.maxTotalGas > currentScope.maxTotalGas) {
      return false;
    }
  }
  
  return true;
}

/**
 * Enhanced revocation checking for delegation validation
 * Integrates with the real-time revocation system
 */
function isRevoked(delegationId: string, checkEmergency: boolean = true): boolean {
  const standardRevocation = revokedDelegations.has(delegationId);
  const emergencyRevocation = checkEmergency && emergencyRevocations.has(delegationId);
  
  return standardRevocation || emergencyRevocation;
}

/**
 * Get current effective scope for a delegation (considering degradations)
 */
function getEffectiveScope(delegationId: string): DelegationScope | null {
  const delegation = activeDelegations.get(delegationId);
  if (!delegation) return null;
  
  const degradation = degradedDelegations.get(delegationId);
  if (degradation) {
    return degradation.currentScope;
  }
  
  return delegation.scope;
}

console.log('🔄 Delegation routes loaded with enhanced revocation system');