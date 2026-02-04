// Agent registration and management routes
// Uses OttoChain metagraph state machines for on-chain identity

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine, getCheckpoint, keyPairFromPrivateKey, generateKeyPair } from '../metagraph.js';

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
// Agent Identity State Machine Definition
// OttoChain-compatible format with proper state/transition structure
// ============================================================================

const AGENT_IDENTITY_DEFINITION = {
  states: {
    Registered: {
      id: { value: 'Registered' },
      isFinal: false,
      metadata: null,
    },
    Active: {
      id: { value: 'Active' },
      isFinal: false,
      metadata: null,
    },
    Withdrawn: {
      id: { value: 'Withdrawn' },
      isFinal: true,
      metadata: null,
    },
  },
  initialState: { value: 'Registered' },
  transitions: [
    {
      from: { value: 'Registered' },
      to: { value: 'Active' },
      eventName: 'activate',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'Active' }] },
      dependencies: [],
    },
    {
      from: { value: 'Active' },
      to: { value: 'Active' },
      eventName: 'receive_vouch',
      guard: { '!!': [{ var: 'event.from' }] },
      effect: {
        merge: [
          { var: 'state' },
          {
            reputation: { '+': [{ var: 'state.reputation' }, 2] },
          },
        ],
      },
      dependencies: [],
    },
    {
      from: { value: 'Active' },
      to: { value: 'Active' },
      eventName: 'receive_completion',
      guard: { '==': [1, 1] },
      effect: {
        merge: [
          { var: 'state' },
          {
            reputation: { '+': [{ var: 'state.reputation' }, 5] },
          },
        ],
      },
      dependencies: [],
    },
    {
      from: { value: 'Active' },
      to: { value: 'Withdrawn' },
      eventName: 'withdraw',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'Withdrawn' }] },
      dependencies: [],
    },
  ],
  metadata: {
    name: 'AgentIdentity',
    description: 'Decentralized agent identity with reputation tracking',
  },
};

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
          // Reputation tracking
          reputation: 10,
          vouches: [],
          completedContracts: 0,
          violations: 0,
          // Status
          status: 'Registered',
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

    // Get current state to determine sequence number
    const state = await getStateMachine(input.fiberId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const targetSequenceNumber = (state.sequenceNumber ?? 0);

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
 */
agentRoutes.post('/activate', async (req, res) => {
  try {
    const { privateKey, fiberId } = req.body;

    if (!privateKey || !fiberId) {
      return res.status(400).json({ error: 'privateKey and fiberId are required' });
    }

    const state = await getStateMachine(fiberId) as { sequenceNumber?: number; currentState?: { value: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (state.currentState?.value !== 'Registered') {
      return res.status(400).json({ 
        error: 'Agent cannot be activated', 
        currentState: state.currentState?.value 
      });
    }

    const message = {
      TransitionStateMachine: {
        fiberId,
        eventName: 'activate',
        payload: {},
        targetSequenceNumber: (state.sequenceNumber ?? 0),
      },
    };

    console.log(`[agent/activate] Activating fiber ${fiberId}`);
    const result = await submitTransaction(message, privateKey);

    res.json({
      hash: result.hash,
      fiberId,
      status: 'Active',
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

    if (state.currentState?.value !== 'Active') {
      return res.status(400).json({ 
        error: 'Can only vouch for active agents',
        currentState: state.currentState?.value 
      });
    }

    // Derive voucher address if not provided
    const voucherAddress = fromAddress ?? keyPairFromPrivateKey(privateKey).address;

    const message = {
      TransitionStateMachine: {
        fiberId: targetFiberId,
        eventName: 'receive_vouch',
        payload: { from: voucherAddress, reason: reason ?? '' },
        targetSequenceNumber: (state.sequenceNumber ?? 0),
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
