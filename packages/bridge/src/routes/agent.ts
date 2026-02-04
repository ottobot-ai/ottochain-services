// Agent registration and management routes

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine, getCheckpoint } from '../metagraph.js';

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
// ============================================================================

const AGENT_IDENTITY_DEFINITION = {
  states: ['Registered', 'Active', 'Withdrawn'],
  initialState: 'Registered',
  transitions: [
    {
      from: 'Registered',
      event: 'activate',
      to: 'Active',
      guards: [],
      effects: [{ op: 'merge', path: ['status'], value: 'Active' }],
    },
    {
      from: 'Active',
      event: 'receive_vouch',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { '+': [{ var: 'reputation' }, 2] } },
        { op: 'push', path: ['vouches'], value: { var: 'event.from' } },
      ],
    },
    {
      from: 'Active',
      event: 'receive_completion',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { '+': [{ var: 'reputation' }, 5] } },
      ],
    },
    {
      from: 'Active',
      event: 'receive_violation',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { max: [0, { '-': [{ var: 'reputation' }, 10] }] } },
      ],
    },
    {
      from: 'Active',
      event: 'withdraw',
      to: 'Withdrawn',
      guards: [],
      effects: [{ op: 'merge', path: ['status'], value: 'Withdrawn' }],
    },
  ],
};

// ============================================================================
// Routes
// ============================================================================

/**
 * Register a new agent identity
 * POST /agent/register
 * 
 * Creates a new AgentIdentity state machine on the metagraph.
 */
agentRoutes.post('/register', async (req, res) => {
  try {
    const input = RegisterRequestSchema.parse(req.body);
    
    const fiberId = randomUUID();
    
    const message = {
      CreateStateMachine: {
        fiberId,
        definition: AGENT_IDENTITY_DEFINITION,
        initialData: {
          displayName: input.displayName ?? null,
          platform: input.platform ?? null,
          platformUserId: input.platformUserId ?? null,
          reputation: 10,
          vouches: [],
          status: 'Registered',
          createdAt: new Date().toISOString(),
        },
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      fiberId,
      hash: result.hash,
      message: 'Agent identity created. Call /agent/activate to activate.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
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
    const targetSequenceNumber = (state.sequenceNumber ?? 0) + 1;

    const message = {
      TransitionStateMachine: {
        fiberId: input.fiberId,
        eventName: input.event,
        payload: input.payload ?? {},
        targetSequenceNumber,
      },
    };

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
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
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

    const state = await getStateMachine(targetFiberId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Target agent not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: targetFiberId,
        eventName: 'receive_vouch',
        payload: { from: fromAddress, reason: reason ?? '' },
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, privateKey);

    res.json({
      hash: result.hash,
      event: 'vouch',
      targetFiberId,
    });
  } catch (err) {
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
