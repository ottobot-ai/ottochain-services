// Contract management routes
// Uses OttoChain metagraph state machines for on-chain contracts

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getStateMachine, 
  getCheckpoint, 
  keyPairFromPrivateKey,
  getFiberSequenceNumber,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';
import { getContractDefinition } from '@ottochain/sdk/apps/contracts';

// Move documentation-only fields into metadata instead of stripping them
// The metagraph schema doesn't have crossReferences/emits at top level,
// but metadata accepts arbitrary JSON, so we preserve them there.
function moveDocsToMetadata(def: unknown): StateMachineDefinition {
  const raw = def as Record<string, unknown>;
  const { crossReferences, metadata: existingMetadata, ...rest } = raw;
  
  // Collect emits from transitions to preserve in metadata
  const transitionEmits: Record<string, unknown> = {};
  if (Array.isArray(rest.transitions)) {
    rest.transitions = rest.transitions.map((t: Record<string, unknown>, idx: number) => {
      const { emits, ...transition } = t;
      if (emits) {
        const key = `${transition.from}_${transition.eventName ?? 'event'}_${transition.to}`;
        transitionEmits[key] = emits;
      }
      return transition;
    });
  }
  
  // Build metadata with preserved documentation fields
  const metadata = {
    ...(existingMetadata as Record<string, unknown> ?? {}),
    ...(crossReferences ? { crossReferences } : {}),
    ...(Object.keys(transitionEmits).length > 0 ? { transitionEmits } : {}),
  };
  
  return {
    ...rest,
    metadata,
  } as unknown as StateMachineDefinition;
}

const CONTRACT_DEFINITION = moveDocsToMetadata(getContractDefinition());

export const contractRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const ProposeRequestSchema = z.object({
  privateKey: z.string().length(64),
  counterpartyAddress: z.string(),
  terms: z.record(z.any()),
  title: z.string().optional(),
  description: z.string().optional(),
});

const ContractActionSchema = z.object({
  privateKey: z.string().length(64),
  contractId: z.string().uuid(),
  proof: z.string().optional(),
  reason: z.string().optional(),
});

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

    // Derive proposer address from private key
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const proposerAddress = keyPair.address;

    const contractId = randomUUID();

    const message = {
      CreateStateMachine: {
        fiberId: contractId,
        definition: CONTRACT_DEFINITION,
        initialData: {
          // Schema field for indexer filtering
          schema: 'Contract',
          // Contract metadata
          title: input.title ?? 'Untitled Contract',
          description: input.description ?? '',
          // Parties
          proposer: proposerAddress,
          counterparty: input.counterpartyAddress,
          // Terms
          terms: input.terms,
          // Tracking
          completions: [],
          status: 'PROPOSED',
          proposedAt: new Date().toISOString(),
        },
        parentFiberId: null,
      },
    };

    console.log(`[contract/propose] Creating Contract fiber ${contractId}`);
    console.log(`  Proposer: ${proposerAddress}`);
    console.log(`  Counterparty: ${input.counterpartyAddress}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      contractId,
      proposer: proposerAddress,
      counterparty: input.counterpartyAddress,
      hash: result.hash,
      message: 'Contract proposed. Awaiting counterparty acceptance.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[contract/propose] Error:', err);
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

    const state = await getStateMachine(input.contractId) as { 
      sequenceNumber?: number; 
      stateData?: { counterparty?: string };
      currentState?: { value: string };
    } | null;
    
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (state.currentState?.value !== 'PROPOSED') {
      return res.status(400).json({ 
        error: 'Contract is not in Proposed state',
        currentState: state.currentState?.value 
      });
    }

    // Verify caller is counterparty
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;
    if (state.stateData?.counterparty !== callerAddress) {
      return res.status(403).json({ 
        error: 'Only counterparty can accept',
        expected: state.stateData?.counterparty,
        got: callerAddress,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.contractId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'accept',
        payload: { agent: callerAddress },
        targetSequenceNumber,
      },
    };

    console.log(`[contract/accept] ${callerAddress} accepting contract ${input.contractId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'ACTIVE',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[contract/accept] Error:', err);
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

    const state = await getStateMachine(input.contractId) as { 
      sequenceNumber?: number; 
      stateData?: { counterparty?: string };
      currentState?: { value: string };
    } | null;
    
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (state.currentState?.value !== 'PROPOSED') {
      return res.status(400).json({ 
        error: 'Contract is not in Proposed state',
        currentState: state.currentState?.value 
      });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.contractId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'reject',
        payload: { agent: callerAddress, reason: input.reason ?? '' },
        targetSequenceNumber,
      },
    };

    console.log(`[contract/reject] ${callerAddress} rejecting contract ${input.contractId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'REJECTED',
    });
  } catch (err) {
    console.error('[contract/reject] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Reject failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Submit completion proof (either party)
 * POST /contract/complete
 */
contractRoutes.post('/complete', async (req, res) => {
  try {
    const input = ContractActionSchema.parse(req.body);

    const state = await getStateMachine(input.contractId) as { 
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;
    
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'Contract is not Active',
        currentState: state.currentState?.value 
      });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.contractId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'submit_completion',
        payload: { agent: callerAddress, proof: input.proof ?? '' },
        targetSequenceNumber,
      },
    };

    console.log(`[contract/complete] ${callerAddress} submitting completion for ${input.contractId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      message: 'Completion recorded. Both parties must complete to finalize.',
    });
  } catch (err) {
    console.error('[contract/complete] Error:', err);
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

    const state = await getStateMachine(input.contractId) as { 
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { completions?: unknown[] };
    } | null;
    
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'Contract is not Active',
        currentState: state.currentState?.value 
      });
    }

    const completionCount = state.stateData?.completions?.length ?? 0;
    if (completionCount < 2) {
      return res.status(400).json({ 
        error: 'Both parties must submit completion before finalizing',
        completions: completionCount,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.contractId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'finalize',
        payload: {},
        targetSequenceNumber,
      },
    };

    console.log(`[contract/finalize] Finalizing contract ${input.contractId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'COMPLETED',
    });
  } catch (err) {
    console.error('[contract/finalize] Error:', err);
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

    const state = await getStateMachine(input.contractId) as { 
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;
    
    if (!state) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'Can only dispute Active contracts',
        currentState: state.currentState?.value 
      });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.contractId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.contractId,
        eventName: 'dispute',
        payload: { agent: callerAddress, reason: input.reason },
        targetSequenceNumber,
      },
    };

    console.log(`[contract/dispute] ${callerAddress} disputing contract ${input.contractId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      contractId: input.contractId,
      status: 'DISPUTED',
    });
  } catch (err) {
    console.error('[contract/dispute] Error:', err);
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

/**
 * List all contracts (from metagraph checkpoint)
 * GET /contract
 */
contractRoutes.get('/', async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint() as { 
      state: { 
        stateMachines: Record<string, { 
          stateData?: { schema?: string };
          definition?: { metadata?: { name?: string } };
        }> 
      } 
    };
    
    // Filter state machines that are Contracts
    const contracts: Record<string, unknown> = {};
    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      if (
        sm.stateData?.schema === 'Contract' ||
        sm.definition?.metadata?.name === 'Contract'
      ) {
        contracts[fiberId] = sm;
      }
    }
    
    res.json({
      count: Object.keys(contracts).length,
      contracts,
    });
  } catch (err) {
    console.error('[contract/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
