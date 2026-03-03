/**
 * Client-Side Signing Build Routes
 *
 * Returns unsigned payloads for clients to sign locally.
 * Part of Epic B: Client-Side Signing Refactor.
 *
 * Flow: client calls /build/* → signs locally → submits to /submit
 *
 * Endpoints:
 *   POST /build/sm/create     — returns unsigned CreateStateMachine
 *   POST /build/sm/transition — returns unsigned TransitionStateMachine
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  getFiberSequenceNumber,
  getStateMachine,
  type StateMachineDefinition,
} from '../metagraph.js';

export const buildRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const BuildCreateSchema = z.object({
  definition: z.object({
    metadata: z.object({
      name: z.string(),
      description: z.string().optional(),
      version: z.string().optional(),
    }),
    states: z.record(z.any()),
    initialState: z.string(),
    transitions: z.array(z.any()),
  }),
  initialData: z.record(z.any()).optional().default({}),
  fiberId: z.string().uuid().optional(),
  participants: z.array(z.string()).optional(),
});

const BuildTransitionSchema = z.object({
  fiberId: z.string().uuid(),
  eventName: z.string(),
  payload: z.record(z.any()).optional().default({}),
});

// ============================================================================
// POST /build/sm/create — Return unsigned CreateStateMachine
// ============================================================================

buildRoutes.post('/sm/create', async (req, res) => {
  try {
    const body = BuildCreateSchema.parse(req.body);
    const fiberId = body.fiberId ?? randomUUID();

    const unsigned = {
      CreateStateMachine: {
        fiberId,
        definition: body.definition as StateMachineDefinition,
        initialData: body.initialData,
        ...(body.participants && { participants: body.participants }),
      },
    };

    res.json({
      fiberId,
      unsigned,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

// ============================================================================
// POST /build/sm/transition — Return unsigned TransitionStateMachine
// ============================================================================

buildRoutes.post('/sm/transition', async (req, res) => {
  try {
    const body = BuildTransitionSchema.parse(req.body);

    // Fetch current fiber state and sequence number
    const [fiber, seqResult] = await Promise.all([
      getStateMachine(body.fiberId).catch(() => null),
      getFiberSequenceNumber(body.fiberId).catch(() => ({ sequenceNumber: 0 })),
    ]);

    if (!fiber) {
      res.status(404).json({ error: `Fiber ${body.fiberId} not found` });
      return;
    }

    const targetSequenceNumber = seqResult.sequenceNumber + 1;

    const unsigned = {
      TransitionStateMachine: {
        fiberId: body.fiberId,
        eventName: body.eventName,
        payload: body.payload,
        targetSequenceNumber,
      },
    };

    res.json({
      unsigned,
      currentState: fiber.currentState ?? fiber.state,
      targetSequenceNumber,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});
