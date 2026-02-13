// Delegation routes
// Support for delegated transaction signing and relayer pattern

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  keyPairFromPrivateKey,
  type Address,
} from '../metagraph.js';

export const delegateRoutes: RouterType = Router();

// ============================================================================
// Types & Schemas (will be replaced when delegation protocol schema is ready)
// ============================================================================

// Temporary delegation structure - to be replaced by protobuf schema
interface DelegationAuthority {
  id: string;
  delegator: Address;
  delegatee: Address;
  scope: string[];
  expiresAt: number;
  createdAt: number;
  status: 'active' | 'revoked' | 'expired';
  signature?: string;
}

// In-memory store for delegations (will be replaced by proper state storage)
const delegations = new Map<string, DelegationAuthority>();

const SubmitDelegatedTxSchema = z.object({
  transaction: z.record(z.any()), // Transaction to submit
  delegationId: z.string().uuid(),
  relayerPrivateKey: z.string().length(64),
  proof: z.string().optional(), // Delegation proof/signature
});

const CreateDelegationSchema = z.object({
  delegatorPrivateKey: z.string().length(64),
  delegateeAddress: z.string(),
  scope: z.array(z.string()), // Transaction types/operations allowed
  expiresIn: z.number().min(1), // Seconds from now
});

const RevokeDelegationSchema = z.object({
  delegatorPrivateKey: z.string().length(64),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Submit a delegated transaction through a relayer
 * POST /delegate/submit
 * 
 * Body: { transaction, delegationId, relayerPrivateKey, proof? }
 * Returns: { hash, ordinal? }
 */
delegateRoutes.post('/submit', async (req, res) => {
  try {
    const body = SubmitDelegatedTxSchema.parse(req.body);
    const { transaction, delegationId, relayerPrivateKey, proof } = body;

    // Validate delegation exists and is active
    const delegation = delegations.get(delegationId);
    if (!delegation) {
      return res.status(404).json({ error: 'Delegation not found' });
    }

    if (delegation.status !== 'active') {
      return res.status(400).json({ error: `Delegation is ${delegation.status}` });
    }

    if (Date.now() > delegation.expiresAt) {
      // Auto-expire delegation
      delegation.status = 'expired';
      return res.status(400).json({ error: 'Delegation has expired' });
    }

    // Verify relayer is the delegated party
    const relayerKeyPair = keyPairFromPrivateKey(relayerPrivateKey);
    if (relayerKeyPair.address !== delegation.delegatee) {
      return res.status(403).json({ error: 'Relayer not authorized for this delegation' });
    }

    // TODO: Validate transaction scope against delegation.scope
    // This will be implemented when protocol schema defines transaction types

    // TODO: Verify delegation proof/signature
    // This will be implemented when delegation protocol is defined

    console.log(`[delegate] Submitting transaction via delegation ${delegationId}`);
    console.log(`[delegate] Delegator: ${delegation.delegator}`);
    console.log(`[delegate] Relayer: ${delegation.delegatee}`);

    // Submit the transaction using relayer's key
    const result = await submitTransaction(transaction, relayerPrivateKey);

    res.json({
      hash: result.hash,
      ordinal: result.ordinal,
      delegationId,
      submittedBy: relayerKeyPair.address,
      onBehalfOf: delegation.delegator,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    
    console.error('[delegate] Submit failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Delegation submission failed: ${message}` });
  }
});

/**
 * Create a delegation authorization (temporary implementation)
 * POST /delegate/create
 * 
 * Body: { delegatorPrivateKey, delegateeAddress, scope, expiresIn }
 * Returns: { delegationId, delegation }
 */
delegateRoutes.post('/create', async (req, res) => {
  try {
    const body = CreateDelegationSchema.parse(req.body);
    const { delegatorPrivateKey, delegateeAddress, scope, expiresIn } = body;

    const delegatorKeyPair = keyPairFromPrivateKey(delegatorPrivateKey);
    const delegationId = randomUUID();

    const delegation: DelegationAuthority = {
      id: delegationId,
      delegator: delegatorKeyPair.address,
      delegatee: delegateeAddress,
      scope,
      expiresAt: Date.now() + (expiresIn * 1000),
      createdAt: Date.now(),
      status: 'active',
    };

    // TODO: Generate proper delegation signature when protocol is defined
    // This should sign the delegation data with delegator's key

    delegations.set(delegationId, delegation);

    console.log(`[delegate] Created delegation ${delegationId}`);
    console.log(`[delegate] From ${delegation.delegator} to ${delegation.delegatee}`);
    console.log(`[delegate] Scope: ${scope.join(', ')}`);
    console.log(`[delegate] Expires: ${new Date(delegation.expiresAt).toISOString()}`);

    res.json({
      delegationId,
      delegation: {
        ...delegation,
        // Don't include sensitive data in response
        signature: undefined,
      },
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    
    console.error('[delegate] Create failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Delegation creation failed: ${message}` });
  }
});

/**
 * Get delegation status
 * GET /delegate/status/:delegationId
 * 
 * Returns: { delegation } or 404
 */
delegateRoutes.get('/status/:delegationId', (req, res) => {
  const delegationId = req.params.delegationId;

  const delegation = delegations.get(delegationId);
  if (!delegation) {
    return res.status(404).json({ error: 'Delegation not found' });
  }

  // Check and update expiration status
  if (delegation.status === 'active' && Date.now() > delegation.expiresAt) {
    delegation.status = 'expired';
  }

  res.json({
    delegation: {
      ...delegation,
      // Don't expose signature in status response
      signature: undefined,
    },
  });
});

/**
 * Revoke a delegation
 * DELETE /delegate/revoke/:delegationId
 * 
 * Body: { delegatorPrivateKey }
 * Returns: { success: true }
 */
delegateRoutes.delete('/revoke/:delegationId', (req, res) => {
  try {
    const delegationId = req.params.delegationId;
    const body = RevokeDelegationSchema.parse(req.body);
    const { delegatorPrivateKey } = body;

    const delegation = delegations.get(delegationId);
    if (!delegation) {
      return res.status(404).json({ error: 'Delegation not found' });
    }

    // Verify caller is the delegator
    const delegatorKeyPair = keyPairFromPrivateKey(delegatorPrivateKey);
    if (delegatorKeyPair.address !== delegation.delegator) {
      return res.status(403).json({ error: 'Only the delegator can revoke this delegation' });
    }

    if (delegation.status === 'revoked') {
      return res.status(400).json({ error: 'Delegation already revoked' });
    }

    delegation.status = 'revoked';

    console.log(`[delegate] Revoked delegation ${delegationId}`);
    console.log(`[delegate] Revoked by ${delegation.delegator}`);

    res.json({ success: true });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    
    console.error('[delegate] Revoke failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Delegation revocation failed: ${message}` });
  }
});

/**
 * Get active delegations for an address
 * GET /delegate/active?delegator=ADDRESS or GET /delegate/active?delegatee=ADDRESS
 * 
 * Returns: { delegations: DelegationAuthority[] }
 */
delegateRoutes.get('/active', (req, res) => {
  const { delegator, delegatee } = req.query;

  if (!delegator && !delegatee) {
    return res.status(400).json({ error: 'Either delegator or delegatee address is required' });
  }

  const activeDelegations = Array.from(delegations.values()).filter(delegation => {
    // Update expired status
    if (delegation.status === 'active' && Date.now() > delegation.expiresAt) {
      delegation.status = 'expired';
    }

    // Filter by delegator or delegatee and active status
    const matchesFilter = (delegator && delegation.delegator === delegator) ||
                         (delegatee && delegation.delegatee === delegatee);
    
    return matchesFilter && delegation.status === 'active';
  }).map(delegation => ({
    ...delegation,
    // Don't expose signatures
    signature: undefined,
  }));

  res.json({ delegations: activeDelegations });
});

/**
 * Health check for delegation service
 * GET /delegate/health
 * 
 * Returns: service status and delegation count
 */
delegateRoutes.get('/health', (req, res) => {
  const total = delegations.size;
  const active = Array.from(delegations.values()).filter(d => {
    if (d.status === 'active' && Date.now() > d.expiresAt) {
      d.status = 'expired';
    }
    return d.status === 'active';
  }).length;

  res.json({
    status: 'ok',
    service: 'delegation',
    stats: {
      totalDelegations: total,
      activeDelegations: active,
    },
  });
});