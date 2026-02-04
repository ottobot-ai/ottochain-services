// Contract management routes

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine } from '../metagraph.js';

export const contractRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const ProposeRequestSchema = z.object({
  privateKey: z.string().length(64),
  proposerAddress: z.string(),
  counterpartyAddress: z.string(),
  terms: z.record(z.any()),
});

const ContractActionSchema = z.object({
  privateKey: z.string().length(64),
  contractId: z.string().uuid(),
  proof: z.string().optional(),
  reason: z.string().optional(),
});

// ============================================================================
// Contract State Machine Definition
// ============================================================================

const CONTRACT_DEFINITION = {
  states: ['Proposed', 'Active', 'Completed', 'Disputed', 'Rejected'],
  initialState: 'Proposed',
  transitions: [
    {
      from: 'Proposed',
      event: 'accept',
      to: 'Active',
      guards: [{ '==': [{ var: 'event.agent' }, { var: 'counterparty' }] }],
      effects: [{ op: 'merge', path: ['acceptedAt'], value: { var: '$timestamp' } }],
    },
    {
      from: 'Proposed',
      event: 'reject',
      to: 'Rejected',
      guards: [{ '==': [{ var: 'event.agent' }, { var: 'counterparty' }] }],
      effects: [{ op: 'merge', path: ['rejectedAt'], value: { var: '$timestamp' } }],
    },
    {
      from: 'Active',
      event: 'complete',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'push', path: ['completions'], value: { agent: { var: 'event.agent' }, proof: { var: 'event.proof' } } },
      ],
    },
    {
      from: 'Active',
      event: 'finalize',
      to: 'Completed',
      guards: [{ '>=': [{ count: { var: 'completions' } }, 2] }],
      effects: [{ op: 'merge', path: ['completedAt'], value: { var: '$timestamp' } }],
    },
    {
      from: 'Active',
      event: 'dispute',
      to: 'Disputed',
      guards: [],
      effects: [
        { op: 'merge', path: ['disputedAt'], value: { var: '$timestamp' } },
        { op: 'merge', path: ['disputeReason'], value: { var: 'event.reason' } },
        { op: 'merge', path: ['disputedBy'], value: { var: 'event.agent' } },
      ],
    },
  ],
};

// ============================================================================
// Routes
// ============================================================================

/**
 * Propose a new contract
 * POST /contract/propose
 */
contractRoutes.post('/propose', async (req, res) => {
  try {
    const input = ProposeRequestSchema.parse(req.body);

    const contractId = randomUUID();

    const message = {
      CreateStateMachine: {
        fiberId: contractId,
        definition: CONTRACT_DEFINITION,
        initialData: {
          proposer: input.proposerAddress,
          counterparty: input.counterpartyAddress,
          terms: input.terms,
          completions: [],
          status: 'Proposed',
          proposedAt: new Date().toISOString(),
        },
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      contractId,
      hash: result.hash,
      message: 'Contract proposed. Awaiting counterparty acceptance.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    const errorMessage = err instanceof Error ? err.message : 'Proposal failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Accept a contract (counterparty only)
 * POST /contract/accept
 */
contractRoutes.post('/accept', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    const state = await getStateMachine(input.contractId) as { sequenceNumber?: number; data?: { counterparty?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'accept',
        payload: { agent: state.data?.counterparty },
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'Active',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    const errorMessage = err instanceof Error ? err.message : 'Accept failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Reject a contract (counterparty only)
 * POST /contract/reject
 */
contractRoutes.post('/reject', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    const state = await getStateMachine(input.contractId) as { sequenceNumber?: number; data?: { counterparty?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'reject',
        payload: { agent: state.data?.counterparty, reason: input.reason },
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'Rejected',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Reject failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Mark work as complete (either party)
 * POST /contract/complete
 */
contractRoutes.post('/complete', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    const state = await getStateMachine(input.contractId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'complete',
        payload: { agent: 'caller', proof: input.proof ?? '' },
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      message: 'Completion recorded. Both parties must complete to finalize.',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Complete failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Finalize a completed contract
 * POST /contract/finalize
 */
contractRoutes.post('/finalize', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    const state = await getStateMachine(input.contractId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'finalize',
        payload: {},
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'Completed',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Finalize failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Dispute a contract
 * POST /contract/dispute
 */
contractRoutes.post('/dispute', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    if (!input.reason) {
      return res.status(400).json({ error: 'reason is required for disputes' });
    }

    const state = await getStateMachine(input.contractId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'dispute',
        payload: { agent: 'caller', reason: input.reason },
        targetSequenceNumber: (state.sequenceNumber ?? 0) + 1,
      },
    };

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'Disputed',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Dispute failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get contract state
 * GET /contract/:contractId
 */
contractRoutes.get('/:contractId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.contractId);
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});
