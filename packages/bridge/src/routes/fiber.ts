/**
 * Generic Fiber Routes
 * 
 * Unified API for creating and transitioning any state machine fiber.
 * Supports all workflow types (Voting, TokenEscrow, TicTacToe, etc.)
 * 
 * The /agent and /contract routes remain as convenience wrappers
 * with pre-defined state machine definitions.
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine, getCheckpoint, keyPairFromPrivateKey } from '../metagraph.js';

export const fiberRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const CreateFiberRequestSchema = z.object({
  privateKey: z.string().length(64),
  definition: z.object({
    states: z.record(z.object({
      id: z.object({ value: z.string() }),
      isFinal: z.boolean(),
      metadata: z.any().optional(),
    })),
    initialState: z.object({ value: z.string() }),
    transitions: z.array(z.object({
      from: z.object({ value: z.string() }),
      to: z.object({ value: z.string() }),
      eventName: z.string(),
      guard: z.any(),
      effect: z.any(),
      dependencies: z.array(z.string()).optional(),
    })),
    metadata: z.object({
      name: z.string(),
      description: z.string().optional(),
    }).optional(),
  }),
  initialData: z.record(z.any()),
  /** Optional: pre-generated fiber ID */
  fiberId: z.string().uuid().optional(),
  /** Optional: parent fiber for spawned children */
  parentFiberId: z.string().uuid().optional(),
});

const TransitionFiberRequestSchema = z.object({
  privateKey: z.string().length(64),
  fiberId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.any()).optional(),
  /** Optional: specify sequence number for optimistic locking */
  targetSequenceNumber: z.number().int().optional(),
});

const BatchTransitionRequestSchema = z.object({
  transitions: z.array(z.object({
    privateKey: z.string().length(64),
    fiberId: z.string().uuid(),
    event: z.string(),
    payload: z.record(z.any()).optional(),
  })),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Create a new fiber (state machine)
 * POST /fiber/create
 * 
 * Generic endpoint for creating any state machine with custom definition.
 */
fiberRoutes.post('/create', async (req, res) => {
  try {
    const input = CreateFiberRequestSchema.parse(req.body);
    
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const fiberId = input.fiberId ?? randomUUID();
    
    const message = {
      CreateStateMachine: {
        fiberId,
        definition: input.definition,
        initialData: {
          ...input.initialData,
          // Add metadata for indexer filtering
          _schema: input.definition.metadata?.name ?? 'GenericFiber',
          _createdAt: new Date().toISOString(),
          _owner: keyPair.address,
        },
        parentFiberId: input.parentFiberId ?? null,
      },
    };

    console.log(`[fiber/create] Creating ${input.definition.metadata?.name ?? 'fiber'} ${fiberId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      fiberId,
      address: keyPair.address,
      hash: result.hash,
      schema: input.definition.metadata?.name,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[fiber/create] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Create failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Transition a fiber's state
 * POST /fiber/transition
 * 
 * Generic endpoint for triggering any event on any fiber.
 */
fiberRoutes.post('/transition', async (req, res) => {
  try {
    const input = TransitionFiberRequestSchema.parse(req.body);

    // Get current sequence number if not provided
    let targetSeq = input.targetSequenceNumber;
    if (targetSeq === undefined) {
      const state = await getStateMachine(input.fiberId) as { sequenceNumber?: number } | null;
      if (!state) {
        return res.status(404).json({ error: 'Fiber not found' });
      }
      targetSeq = state.sequenceNumber ?? 0;
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.fiberId,
        eventName: input.event,
        payload: input.payload ?? {},
        targetSequenceNumber: targetSeq,
      },
    };

    console.log(`[fiber/transition] Event ${input.event} on fiber ${input.fiberId}`);
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
    console.error('[fiber/transition] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Batch transition multiple fibers
 * POST /fiber/batch
 * 
 * Submit multiple transitions in parallel for higher throughput.
 * Returns results for each transition (success or failure).
 */
fiberRoutes.post('/batch', async (req, res) => {
  try {
    const input = BatchTransitionRequestSchema.parse(req.body);

    const results = await Promise.allSettled(
      input.transitions.map(async (t) => {
        const state = await getStateMachine(t.fiberId) as { sequenceNumber?: number } | null;
        if (!state) {
          throw new Error(`Fiber ${t.fiberId} not found`);
        }

        const message = {
          TransitionStateMachine: {
            fiberId: t.fiberId,
            eventName: t.event,
            payload: t.payload ?? {},
            targetSequenceNumber: state.sequenceNumber ?? 0,
          },
        };

        const result = await submitTransaction(message, t.privateKey);
        return { fiberId: t.fiberId, event: t.event, hash: result.hash };
      })
    );

    const successes = results
      .filter((r): r is PromiseFulfilledResult<{ fiberId: string; event: string; hash: string }> => 
        r.status === 'fulfilled'
      )
      .map((r) => r.value);

    const failures = results
      .map((r, i) => ({ index: i, result: r }))
      .filter((r) => r.result.status === 'rejected')
      .map((r) => ({
        index: r.index,
        fiberId: input.transitions[r.index].fiberId,
        error: (r.result as PromiseRejectedResult).reason?.message ?? 'Unknown error',
      }));

    res.json({
      total: results.length,
      succeeded: successes.length,
      failed: failures.length,
      successes,
      failures,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[fiber/batch] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Batch failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get fiber state by ID
 * GET /fiber/:fiberId
 */
fiberRoutes.get('/:fiberId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.fiberId);
    if (!state) {
      return res.status(404).json({ error: 'Fiber not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List fibers by schema/type
 * GET /fiber?schema=Voting&limit=100
 */
fiberRoutes.get('/', async (req, res) => {
  try {
    const schema = req.query.schema as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    const checkpoint = await getCheckpoint() as {
      state: {
        stateMachines: Record<string, {
          stateData?: { _schema?: string; schema?: string };
          definition?: { metadata?: { name?: string } };
          currentState?: { value: string };
        }>;
      };
    };

    let fibers = Object.entries(checkpoint.state.stateMachines ?? {});

    // Filter by schema if specified
    if (schema) {
      fibers = fibers.filter(([_, sm]) => {
        const smSchema = sm.stateData?._schema || 
                        sm.stateData?.schema || 
                        sm.definition?.metadata?.name;
        return smSchema === schema;
      });
    }

    // Apply limit
    fibers = fibers.slice(0, limit);

    // Format response
    const result = fibers.map(([fiberId, sm]) => ({
      fiberId,
      schema: sm.stateData?._schema || sm.stateData?.schema || sm.definition?.metadata?.name,
      currentState: sm.currentState?.value,
      stateData: sm.stateData,
    }));

    res.json({
      count: result.length,
      fibers: result,
    });
  } catch (err) {
    console.error('[fiber/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
