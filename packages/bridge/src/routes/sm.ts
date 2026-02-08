// Generic State Machine Routes
// Thin wrapper around OttoChain CreateStateMachine / TransitionStateMachine
// Works with ANY state machine definition: Markets, Contracts, Escrows, etc.

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getStateMachine, 
  getCheckpoint, 
  keyPairFromPrivateKey,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';

export const smRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const CreateSMSchema = z.object({
  privateKey: z.string().length(64),
  definition: z.object({
    metadata: z.object({
      name: z.string(),
      description: z.string().optional(),
      version: z.string().optional(),
    }),
    states: z.record(z.any()),
    initialState: z.object({ value: z.string() }),
    transitions: z.array(z.any()),
  }),
  initialData: z.record(z.any()),
  fiberId: z.string().uuid().optional(), // Allow caller to specify ID
});

const TransitionSMSchema = z.object({
  privateKey: z.string().length(64),
  fiberId: z.string().uuid(),
  eventName: z.string(),
  payload: z.record(z.any()).optional(),
});

const QuerySMSchema = z.object({
  schema: z.string().optional(),      // Filter by schema field
  status: z.string().optional(),      // Filter by status field  
  creator: z.string().optional(),     // Filter by creator
  marketType: z.string().optional(),  // Filter by marketType (for Markets)
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Create a new state machine instance
 * POST /sm/create
 */
smRoutes.post('/create', async (req, res) => {
  try {
    const input = CreateSMSchema.parse(req.body);
    
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;
    const fiberId = input.fiberId ?? randomUUID();

    // Inject creator if not set
    const initialData: Record<string, unknown> = {
      ...input.initialData,
      creator: input.initialData.creator ?? creatorAddress,
      createdAt: new Date().toISOString(),
    };

    const message = {
      CreateStateMachine: {
        fiberId,
        definition: input.definition,
        initialData,
        parentFiberId: null,
      },
    };

    const smName = input.definition.metadata.name;
    const schemaName = (initialData.schema as string) ?? smName;
    console.log(`[sm/create] Creating ${smName} fiber ${fiberId}`);
    console.log(`  Creator: ${creatorAddress}`);
    console.log(`  Schema: ${schemaName}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      fiberId,
      creator: creatorAddress,
      schema: schemaName,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[sm/create] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Create failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Trigger a state machine transition
 * POST /sm/transition
 */
smRoutes.post('/transition', async (req, res) => {
  try {
    const input = TransitionSMSchema.parse(req.body);

    const state = await getStateMachine(input.fiberId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      definition?: { metadata?: { name?: string } };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'State machine not found' });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const message = {
      TransitionStateMachine: {
        fiberId: input.fiberId,
        eventName: input.eventName,
        payload: {
          agent: callerAddress,
          ...input.payload,
        },
        targetSequenceNumber: state.sequenceNumber ?? 0,
      },
    };

    const smName = state.definition?.metadata?.name ?? 'SM';
    console.log(`[sm/transition] ${smName} ${input.fiberId}: ${input.eventName}`);
    console.log(`  Agent: ${callerAddress}`);
    console.log(`  Current state: ${state.currentState?.value}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      fiberId: input.fiberId,
      eventName: input.eventName,
      previousState: state.currentState?.value,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[sm/transition] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get state machine by ID
 * GET /sm/:fiberId
 */
smRoutes.get('/:fiberId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.fiberId);
    if (!state) {
      return res.status(404).json({ error: 'State machine not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List state machines with optional filters
 * GET /sm?schema=Market&marketType=prediction&status=OPEN
 */
smRoutes.get('/', async (req, res) => {
  try {
    const query = QuerySMSchema.parse({
      schema: req.query.schema,
      status: req.query.status,
      creator: req.query.creator,
      marketType: req.query.marketType,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });

    const checkpoint = await getCheckpoint() as {
      ordinal: number;
      state: {
        stateMachines?: Record<string, {
          stateData?: Record<string, unknown>;
          currentState?: { value: string };
          definition?: { metadata?: { name?: string } };
        }>;
      };
    };

    let results = Object.entries(checkpoint.state.stateMachines ?? {});

    // Apply filters
    if (query.schema) {
      results = results.filter(([_, sm]) => 
        sm.stateData?.schema === query.schema ||
        sm.definition?.metadata?.name === query.schema
      );
    }
    if (query.status) {
      results = results.filter(([_, sm]) => 
        sm.stateData?.status === query.status ||
        sm.currentState?.value === query.status
      );
    }
    if (query.creator) {
      results = results.filter(([_, sm]) => sm.stateData?.creator === query.creator);
    }
    if (query.marketType) {
      results = results.filter(([_, sm]) => sm.stateData?.marketType === query.marketType);
    }

    const total = results.length;

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    results = results.slice(offset, offset + limit);

    res.json({
      total,
      offset,
      limit,
      count: results.length,
      stateMachines: Object.fromEntries(results),
    });
  } catch (err) {
    console.error('[sm/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Convenience Endpoints (optional, for common patterns)
// ============================================================================

/**
 * Shorthand: commit to a market (stake/bid/pledge)
 * POST /sm/:fiberId/commit
 */
smRoutes.post('/:fiberId/commit', async (req, res) => {
  try {
    const { privateKey, amount, data } = z.object({
      privateKey: z.string().length(64),
      amount: z.number().positive(),
      data: z.record(z.any()).optional(),
    }).parse(req.body);

    const state = await getStateMachine(req.params.fiberId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'State machine not found' });
    }

    if (state.currentState?.value !== 'OPEN') {
      return res.status(400).json({ 
        error: 'Market is not open for commitments',
        currentState: state.currentState?.value,
      });
    }

    const callerAddress = keyPairFromPrivateKey(privateKey).address;

    const message = {
      TransitionStateMachine: {
        fiberId: req.params.fiberId,
        eventName: 'commit',
        payload: { agent: callerAddress, amount, data: data ?? {} },
        targetSequenceNumber: state.sequenceNumber ?? 0,
      },
    };

    console.log(`[sm/commit] ${callerAddress} committing ${amount} to ${req.params.fiberId}`);
    const result = await submitTransaction(message, privateKey);

    res.json({
      fiberId: req.params.fiberId,
      agent: callerAddress,
      amount,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[sm/commit] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Commit failed';
    res.status(500).json({ error: errorMessage });
  }
});
