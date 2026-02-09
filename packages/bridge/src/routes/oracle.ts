// Oracle management routes
// Uses OttoChain metagraph state machines for on-chain oracle registration

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine, getCheckpoint, keyPairFromPrivateKey, waitForFiber, getFiberSequenceNumber } from '../metagraph.js';
import { getOracleDefinition, OracleState, DEFAULT_ORACLE_CONFIG } from '@ottochain/sdk/apps/oracles';

export const oracleRoutes: RouterType = Router();

// ============================================================================
// State Machine Definition (from SDK)
// ============================================================================

const ORACLE_DEFINITION = getOracleDefinition();

// ============================================================================
// Request Schemas
// ============================================================================

const RegisterOracleRequestSchema = z.object({
  privateKey: z.string().length(64),
  stake: z.number().int().min(100).default(100),
  domains: z.array(z.string()).optional().default([]),
  minStake: z.number().int().min(1).optional(),
});

const StakeRequestSchema = z.object({
  privateKey: z.string().length(64),
  oracleId: z.string().uuid(),
  amount: z.number().int().positive(),
});

const RecordResolutionRequestSchema = z.object({
  privateKey: z.string().length(64),
  oracleId: z.string().uuid(),
  marketId: z.string().uuid(),
  correct: z.boolean(),
});

const SlashRequestSchema = z.object({
  privateKey: z.string().length(64),
  oracleId: z.string().uuid(),
  amount: z.number().int().positive(),
  reason: z.enum(['TIMEOUT', 'WRONG_ANSWER', 'COLLUSION', 'MISCONDUCT']),
  marketId: z.string().uuid().optional(),
});

const TransitionRequestSchema = z.object({
  privateKey: z.string().length(64),
  oracleId: z.string().uuid(),
  event: z.enum(['activate', 'reactivate', 'withdraw']),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register as an oracle
 * POST /oracle/register
 */
oracleRoutes.post('/register', async (req, res) => {
  try {
    const input = RegisterOracleRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const oracleAddress = keyPair.address;

    const oracleId = randomUUID();

    const message = {
      CreateStateMachine: {
        fiberId: oracleId,
        definition: ORACLE_DEFINITION,
        initialData: {
          schema: 'Oracle',
          address: oracleAddress,
          stake: 0,
          minStake: input.minStake ?? DEFAULT_ORACLE_CONFIG.minStake,
          reputation: {
            accuracy: 100,
            totalResolutions: 0,
            disputesWon: 0,
            disputesLost: 0,
          },
          domains: input.domains,
          slashingHistory: [],
          status: 'UNREGISTERED',
        },
        parentFiberId: null,
      },
    };

    console.log(`[oracle/register] Creating oracle ${oracleId} for ${oracleAddress}`);
    const result = await submitTransaction(message, input.privateKey);

    // Now register with stake
    const fiberVisible = await waitForFiber(oracleId, 30, 1000);
    if (!fiberVisible) {
      return res.status(201).json({
        oracleId,
        address: oracleAddress,
        hash: result.hash,
        status: 'UNREGISTERED',
        message: 'Oracle created but registration pending. Call /oracle/stake to complete.',
      });
    }

    // Submit registration transition with stake
    const registerMessage = {
      TransitionStateMachine: {
        fiberId: oracleId,
        eventName: 'register',
        payload: {
          agent: oracleAddress,
          stake: input.stake,
          domains: input.domains,
        },
        targetSequenceNumber: 0,
      },
    };

    const registerResult = await submitTransaction(registerMessage, input.privateKey);

    res.status(201).json({
      oracleId,
      address: oracleAddress,
      stake: input.stake,
      domains: input.domains,
      hash: registerResult.hash,
      status: 'REGISTERED',
      message: 'Oracle registered. Call /oracle/activate to activate.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[oracle/register] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Registration failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Activate oracle (after registration)
 * POST /oracle/activate
 */
oracleRoutes.post('/activate', async (req, res) => {
  try {
    const { privateKey, oracleId } = req.body;

    if (!privateKey || !oracleId) {
      return res.status(400).json({ error: 'privateKey and oracleId are required' });
    }

    const callerAddress = keyPairFromPrivateKey(privateKey).address;

    const state = await getStateMachine(oracleId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { address?: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }

    if (state.currentState?.value !== 'REGISTERED') {
      return res.status(400).json({
        error: 'Oracle must be in REGISTERED state to activate',
        currentState: state.currentState?.value,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(oracleId);

    const message = {
      TransitionStateMachine: {
        fiberId: oracleId,
        eventName: 'activate',
        payload: { agent: callerAddress },
        targetSequenceNumber,
      },
    };

    console.log(`[oracle/activate] Activating oracle ${oracleId}`);
    const result = await submitTransaction(message, privateKey);

    res.json({
      oracleId,
      hash: result.hash,
      status: 'ACTIVE',
      message: 'Oracle activated and ready to provide attestations',
    });
  } catch (err) {
    console.error('[oracle/activate] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Activation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Add stake to oracle
 * POST /oracle/stake
 */
oracleRoutes.post('/stake', async (req, res) => {
  try {
    const input = StakeRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.oracleId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { address?: string; stake?: number };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Oracle must be ACTIVE to add stake',
        currentState: state.currentState?.value,
      });
    }

    if (state.stateData?.address !== callerAddress) {
      return res.status(403).json({ error: 'Only oracle owner can add stake' });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.oracleId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.oracleId,
        eventName: 'add_stake',
        payload: {
          agent: callerAddress,
          amount: input.amount,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[oracle/stake] Adding ${input.amount} stake to oracle ${input.oracleId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      oracleId: input.oracleId,
      addedStake: input.amount,
      newTotalStake: (state.stateData?.stake ?? 0) + input.amount,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[oracle/stake] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Stake failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Record a resolution (typically called by market settlement)
 * POST /oracle/record-resolution
 */
oracleRoutes.post('/record-resolution', async (req, res) => {
  try {
    const input = RecordResolutionRequestSchema.parse(req.body);

    const state = await getStateMachine(input.oracleId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Oracle must be ACTIVE to record resolution',
        currentState: state.currentState?.value,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.oracleId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.oracleId,
        eventName: 'record_resolution',
        payload: {
          marketId: input.marketId,
          correct: input.correct,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[oracle/record-resolution] Recording ${input.correct ? 'correct' : 'incorrect'} resolution for oracle ${input.oracleId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      oracleId: input.oracleId,
      marketId: input.marketId,
      correct: input.correct,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[oracle/record-resolution] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Record resolution failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Slash an oracle
 * POST /oracle/slash
 */
oracleRoutes.post('/slash', async (req, res) => {
  try {
    const input = SlashRequestSchema.parse(req.body);

    const state = await getStateMachine(input.oracleId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { stake?: number };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Oracle must be ACTIVE to be slashed',
        currentState: state.currentState?.value,
      });
    }

    if (input.amount > (state.stateData?.stake ?? 0)) {
      return res.status(400).json({
        error: 'Slash amount exceeds stake',
        stake: state.stateData?.stake,
        requestedSlash: input.amount,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.oracleId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.oracleId,
        eventName: 'slash',
        payload: {
          amount: input.amount,
          reason: input.reason,
          marketId: input.marketId,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[oracle/slash] Slashing oracle ${input.oracleId} for ${input.reason}: ${input.amount}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      oracleId: input.oracleId,
      slashedAmount: input.amount,
      reason: input.reason,
      newStatus: 'SLASHED',
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[oracle/slash] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Slash failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Transition oracle state (reactivate, withdraw)
 * POST /oracle/transition
 */
oracleRoutes.post('/transition', async (req, res) => {
  try {
    const input = TransitionRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.oracleId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { address?: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }

    // Validate transition is allowed from current state
    const currentState = state.currentState?.value;
    const validTransitions: Record<string, string[]> = {
      REGISTERED: ['activate'],
      ACTIVE: ['withdraw'],
      SLASHED: ['reactivate', 'withdraw'],
    };

    if (!validTransitions[currentState ?? '']?.includes(input.event)) {
      return res.status(400).json({
        error: `Cannot ${input.event} from ${currentState} state`,
        currentState,
        validEvents: validTransitions[currentState ?? ''] ?? [],
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.oracleId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.oracleId,
        eventName: input.event,
        payload: { agent: callerAddress },
        targetSequenceNumber,
      },
    };

    console.log(`[oracle/transition] ${input.event} on oracle ${input.oracleId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      oracleId: input.oracleId,
      event: input.event,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[oracle/transition] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get oracle by ID
 * GET /oracle/:oracleId
 */
oracleRoutes.get('/:oracleId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.oracleId);
    if (!state) {
      return res.status(404).json({ error: 'Oracle not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List all oracles
 * GET /oracle
 */
oracleRoutes.get('/', async (req, res) => {
  try {
    const { status, domain } = req.query;

    const checkpoint = await getCheckpoint() as {
      state: {
        stateMachines: Record<string, {
          stateData?: { schema?: string; status?: string; domains?: string[] };
          currentState?: { value: string };
        }>;
      };
    };

    const oracles: Record<string, unknown> = {};

    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      if (sm.stateData?.schema !== 'Oracle') continue;

      // Filter by status if specified
      if (status && sm.stateData?.status !== status) continue;

      // Filter by domain if specified
      if (domain && !sm.stateData?.domains?.includes(domain as string)) continue;

      oracles[fiberId] = sm;
    }

    res.json({
      count: Object.keys(oracles).length,
      oracles,
    });
  } catch (err) {
    console.error('[oracle/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
