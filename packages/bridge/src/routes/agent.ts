// Agent registration and management routes
// Uses OttoChain metagraph state machines for on-chain identity

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getStateMachine, 
  getCheckpoint, 
  keyPairFromPrivateKey, 
  generateKeyPair, 
  waitForFiber,
  getFiberSequenceNumber,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';
import { getIdentityDefinition, DEFAULT_REPUTATION_CONFIG } from '@ottochain/sdk/apps/identity';

const AGENT_IDENTITY_DEFINITION = getIdentityDefinition() as StateMachineDefinition;

export const agentRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const RegisterRequestSchema = z.object({
  privateKey: z.string().length(64),
  displayName: z.string().optional(),
  platform: z.string().optional(),
  platformUserId: z.string().optional(),
});

const TransitionRequestSchema = z.object({
  privateKey: z.string().length(64),
  fiberId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.any()).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Generate a new wallet
 * POST /agent/wallet
 */
agentRoutes.post('/wallet', async (_req, res) => {
  try {
    const keyPair = generateKeyPair();
    res.json({
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      address: keyPair.address,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Wallet generation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Register a new agent identity
 * POST /agent/register
 * 
 * Creates a new AgentIdentity state machine on the metagraph.
 */
agentRoutes.post('/register', async (req, res) => {
  try {
    const input = RegisterRequestSchema.parse(req.body);
    
    // Derive address from private key
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const ownerAddress = keyPair.address;
    
    const fiberId = randomUUID();
    
    const message = {
      CreateStateMachine: {
        fiberId,
        definition: AGENT_IDENTITY_DEFINITION,
        initialData: {
          // Schema field for indexer filtering
          schema: 'AgentIdentity',
          // Agent metadata
          displayName: input.displayName ?? null,
          platform: input.platform ?? null,
          platformUserId: input.platformUserId ?? null,
          owner: ownerAddress,
          // Reputation tracking (uses SDK config)
          reputation: DEFAULT_REPUTATION_CONFIG.baseReputation,
          vouches: [],
          completedContracts: 0,
          violations: 0,
          // Status
          status: 'REGISTERED',
          createdAt: new Date().toISOString(),
        },
        parentFiberId: null,
      },
    };

    console.log(`[agent/register] Creating AgentIdentity fiber ${fiberId} for ${ownerAddress}`);
    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      fiberId,
      address: ownerAddress,
      hash: result.hash,
      message: 'Agent identity created. Call /agent/activate to activate.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent/register] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Registration failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Transition an agent's state machine
 * POST /agent/transition
 * 
 * Events: activate, receive_vouch, receive_completion, receive_violation, withdraw
 */
agentRoutes.post('/transition', async (req, res) => {
  try {
    const input = TransitionRequestSchema.parse(req.body);

    // Verify agent exists
    const state = await getStateMachine(input.fiberId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.fiberId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.fiberId,
        eventName: input.event,
        payload: input.payload ?? {},
        targetSequenceNumber,
      },
    };

    console.log(`[agent/transition] Event ${input.event} on fiber ${input.fiberId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      event: input.event,
      fiberId: input.fiberId,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent/transition] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Activate an agent (shorthand for transition with activate event)
 * POST /agent/activate
 * 
 * This route waits for the fiber to be visible in DL1 state before attempting
 * the transition, which prevents "CidNotFound" errors when activating immediately
 * after registration.
 */
agentRoutes.post('/activate', async (req, res) => {
  try {
    const { privateKey, fiberId, waitForSync = true, maxWaitSeconds = 30 } = req.body;

    if (!privateKey || !fiberId) {
      return res.status(400).json({ error: 'privateKey and fiberId are required' });
    }

    // Wait for fiber to appear in state before activating (prevents CidNotFound)
    if (waitForSync) {
      const fiberVisible = await waitForFiber(fiberId, maxWaitSeconds, 1000);
      if (!fiberVisible) {
        return res.status(503).json({ 
          error: 'Fiber not yet synced to data layer',
          fiberId,
          hint: 'Try again in a few seconds or set waitForSync=false to skip waiting'
        });
      }
    }

    const state = await getStateMachine(fiberId) as { sequenceNumber?: number; currentState?: { value: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (state.currentState?.value !== 'REGISTERED') {
      return res.status(400).json({ 
        error: 'Agent cannot be activated', 
        currentState: state.currentState?.value 
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(fiberId);

    const message = {
      TransitionStateMachine: {
        fiberId,
        eventName: 'activate',
        payload: {},
        targetSequenceNumber,
      },
    };

    console.log(`[agent/activate] Activating fiber ${fiberId}`);
    const result = await submitTransaction(message, privateKey);

    res.json({
      hash: result.hash,
      fiberId,
      status: 'ACTIVE',
    });
  } catch (err) {
    console.error('[agent/activate] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Activation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Vouch for another agent
 * POST /agent/vouch
 * 
 * Shorthand for transitioning the target agent with receive_vouch event.
 */
agentRoutes.post('/vouch', async (req, res) => {
  try {
    const { privateKey, targetFiberId, fromAddress, reason } = req.body;

    if (!privateKey || !targetFiberId) {
      return res.status(400).json({ error: 'privateKey and targetFiberId are required' });
    }

    const state = await getStateMachine(targetFiberId) as { sequenceNumber?: number; currentState?: { value: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Target agent not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'Can only vouch for active agents',
        currentState: state.currentState?.value 
      });
    }

    // Derive voucher address if not provided
    const voucherAddress = fromAddress ?? keyPairFromPrivateKey(privateKey).address;

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(targetFiberId);

    const message = {
      TransitionStateMachine: {
        fiberId: targetFiberId,
        eventName: 'receive_vouch',
        payload: { from: voucherAddress, reason: reason ?? '' },
        targetSequenceNumber,
      },
    };

    console.log(`[agent/vouch] ${voucherAddress} vouching for ${targetFiberId}`);
    const result = await submitTransaction(message, privateKey);

    res.json({
      hash: result.hash,
      event: 'vouch',
      targetFiberId,
      from: voucherAddress,
    });
  } catch (err) {
    console.error('[agent/vouch] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Vouch failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get agent state by fiber ID
 * GET /agent/:fiberId
 */
agentRoutes.get('/:fiberId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.fiberId);
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List all agents (from metagraph checkpoint)
 * GET /agent
 */
agentRoutes.get('/', async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint() as { 
      state: { 
        stateMachines: Record<string, { 
          stateData?: { schema?: string };
          definition?: { metadata?: { name?: string } };
        }> 
      } 
    };
    
    // Filter state machines that are AgentIdentity
    const agents: Record<string, unknown> = {};
    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      if (
        sm.stateData?.schema === 'AgentIdentity' ||
        sm.definition?.metadata?.name === 'AgentIdentity'
      ) {
        agents[fiberId] = sm;
      }
    }
    
    res.json({
      count: Object.keys(agents).length,
      agents,
    });
  } catch (err) {
    console.error('[agent/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
