// Governance and DAO management routes
// Uses OttoChain metagraph state machines for on-chain governance

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
import {
  getDAODefinition,
  getGovernanceDefinition,
  type DAODefinitionType,
  type GovernanceDefinitionType,
} from '@ottochain/sdk/apps/governance';

export const governanceRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const DAOTypeSchema = z.enum(['Single', 'Multisig', 'Threshold', 'Token']);
const GovernanceTypeSchema = z.enum(['Legislature', 'Executive', 'Judiciary', 'Constitution', 'Simple']);
const VoteChoiceSchema = z.enum(['For', 'Against', 'Abstain']);

const CreateDAORequestSchema = z.object({
  privateKey: z.string().length(64),
  daoType: DAOTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  // Multisig-specific
  signers: z.array(z.string()).optional(),
  threshold: z.number().int().min(1).optional(),
  // Token-specific
  tokenId: z.string().uuid().optional(),
  proposalThreshold: z.number().int().min(0).optional(),
  quorum: z.number().int().min(0).optional(),
  // Common config
  votingPeriodMs: z.number().int().optional().default(259200000), // 3 days
  timelockMs: z.number().int().optional().default(86400000), // 1 day
  passingThreshold: z.number().min(0).max(1).optional().default(0.5),
  // Role arrays
  admins: z.array(z.string()).optional(),
  proposers: z.array(z.string()).optional(),
  vetoers: z.array(z.string()).optional(),
});

const ProposeRequestSchema = z.object({
  privateKey: z.string().length(64),
  daoId: z.string().uuid(),
  proposalId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  actionType: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

const VoteRequestSchema = z.object({
  privateKey: z.string().length(64),
  daoId: z.string().uuid(),
  vote: VoteChoiceSchema,
  weight: z.number().int().optional(),
});

const ExecuteRequestSchema = z.object({
  privateKey: z.string().length(64),
  daoId: z.string().uuid(),
});

const DelegateRequestSchema = z.object({
  privateKey: z.string().length(64),
  daoId: z.string().uuid(),
  delegateTo: z.string(),
  weight: z.number().int().optional(),
});

const VetoRequestSchema = z.object({
  privateKey: z.string().length(64),
  daoId: z.string().uuid(),
  reason: z.string().min(1),
});

// ============================================================================
// DAO State Machine Definitions (from SDK)
// ============================================================================

// SDK provides: getDAODefinition(type) for Single, Multisig, Threshold, Token
// SDK provides: getGovernanceDefinition(type) for Legislature, Executive, etc.

/**
 * Get the appropriate state machine definition for a DAO type.
 * Maps bridge DAO types to SDK definitions.
 */
function getDefinitionForDAOType(daoType: string): unknown {
  switch (daoType) {
    case 'Multisig':
      return getDAODefinition('Multisig');
    case 'Token':
      return getDAODefinition('Token');
    case 'Threshold':
      return getDAODefinition('Threshold');
    case 'Single':
      return getDAODefinition('Single');
    default:
      // Fall back to Simple governance for unknown types
      return getGovernanceDefinition('Simple');
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Create a new DAO
 * POST /governance/create-dao
 */
governanceRoutes.post('/create-dao', async (req, res) => {
  try {
    const input = CreateDAORequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;

    const daoId = randomUUID();
    const definition = getDefinitionForDAOType(input.daoType);

    // Build initial data based on DAO type
    let initialData: Record<string, unknown>;

    switch (input.daoType) {
      case 'Multisig':
        if (!input.signers || input.signers.length === 0) {
          return res.status(400).json({ error: 'Multisig requires at least one signer' });
        }
        if (!input.threshold || input.threshold > input.signers.length) {
          return res.status(400).json({ error: 'Threshold must be <= number of signers' });
        }
        initialData = {
          schema: 'MultisigDAO',
          name: input.name,
          description: input.description ?? '',
          signers: input.signers,
          threshold: input.threshold,
          proposalTTLMs: input.votingPeriodMs,
          proposal: null,
          signatures: {},
          actions: [],
          cancelledProposals: [],
          metadata: { createdBy: creatorAddress, createdAt: new Date().toISOString() },
          status: 'ACTIVE',
        };
        break;

      case 'Token':
        if (!input.tokenId) {
          return res.status(400).json({ error: 'Token DAO requires tokenId' });
        }
        initialData = {
          schema: 'TokenDAO',
          name: input.name,
          description: input.description ?? '',
          tokenId: input.tokenId,
          balances: {}, // Will be populated from token fiber
          delegations: {},
          proposalThreshold: input.proposalThreshold ?? 1000,
          votingPeriodMs: input.votingPeriodMs,
          timelockMs: input.timelockMs,
          quorum: input.quorum ?? 10000,
          proposal: null,
          votes: null,
          executedProposals: [],
          rejectedProposals: [],
          cancelledProposals: [],
          metadata: { createdBy: creatorAddress, createdAt: new Date().toISOString() },
          status: 'ACTIVE',
        };
        break;

      default: // Single, Threshold, Simple
        initialData = {
          schema: 'Governance',
          name: input.name,
          description: input.description ?? '',
          admins: input.admins ?? [creatorAddress],
          proposers: input.proposers ?? [],
          vetoers: input.vetoers ?? [],
          executors: input.admins ?? [creatorAddress],
          votingPeriodMs: input.votingPeriodMs,
          vetoPeriodMs: input.timelockMs, // Use timelock as veto period for simple
          passingThreshold: input.passingThreshold,
          allowDelegation: true,
          proposal: null,
          votes: {},
          delegations: {},
          executedProposals: [],
          vetoedProposals: [],
          metadata: { createdBy: creatorAddress, createdAt: new Date().toISOString() },
          status: 'ACTIVE',
        };
    }

    const message = {
      CreateStateMachine: {
        fiberId: daoId,
        definition,
        initialData,
        parentFiberId: null,
      },
    };

    console.log(`[governance/create-dao] Creating ${input.daoType} DAO: ${input.name} (${daoId})`);
    console.log(`  Creator: ${creatorAddress}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      daoId,
      name: input.name,
      daoType: input.daoType,
      creator: creatorAddress,
      hash: result.hash,
      message: 'DAO created successfully',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/create-dao] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'DAO creation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Create a proposal
 * POST /governance/propose
 */
governanceRoutes.post('/propose', async (req, res) => {
  try {
    const input = ProposeRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.daoId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: Record<string, unknown>;
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'DAO is not in Active state (may have pending proposal)',
        currentState: state.currentState?.value,
      });
    }

    const proposalId = input.proposalId ?? randomUUID();

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.daoId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.daoId,
        eventName: 'propose',
        payload: {
          agent: callerAddress,
          proposalId,
          title: input.title,
          description: input.description ?? '',
          actionType: input.actionType ?? 'general',
          payload: input.payload ?? {},
        },
        targetSequenceNumber,
      },
    };

    console.log(`[governance/propose] ${callerAddress} proposing to DAO ${input.daoId}`);
    console.log(`  Proposal: ${input.title} (${proposalId})`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      proposalId,
      daoId: input.daoId,
      proposer: callerAddress,
      hash: result.hash,
      message: 'Proposal created',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/propose] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Proposal failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Cast a vote
 * POST /governance/vote
 */
governanceRoutes.post('/vote', async (req, res) => {
  try {
    const input = VoteRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.daoId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { schema?: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // For multisig, voting = signing; for others, need VOTING state
    const schema = state.stateData?.schema;
    const isMultisig = schema === 'MultisigDAO';

    if (isMultisig) {
      if (state.currentState?.value !== 'PENDING') {
        return res.status(400).json({
          error: 'Multisig: No pending proposal to sign',
          currentState: state.currentState?.value,
        });
      }
    } else {
      if (state.currentState?.value !== 'VOTING') {
        return res.status(400).json({
          error: 'DAO is not in Voting state',
          currentState: state.currentState?.value,
        });
      }
    }

    const eventName = isMultisig ? 'sign' : 'vote';
    const payload = isMultisig
      ? { agent: callerAddress }
      : { agent: callerAddress, vote: input.vote.toLowerCase(), weight: input.weight ?? 1 };

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.daoId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.daoId,
        eventName,
        payload,
        targetSequenceNumber,
      },
    };

    console.log(`[governance/vote] ${callerAddress} ${isMultisig ? 'signing' : 'voting'} on DAO ${input.daoId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      daoId: input.daoId,
      voter: callerAddress,
      action: isMultisig ? 'signed' : `voted ${input.vote}`,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/vote] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Vote failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Execute a passed proposal
 * POST /governance/execute
 */
governanceRoutes.post('/execute', async (req, res) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.daoId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { schema?: string; proposal?: { id: string } };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    const currentState = state.currentState?.value;
    const schema = state.stateData?.schema;

    // Determine valid execute states based on schema
    const isMultisig = schema === 'MultisigDAO';
    const isTokenDAO = schema === 'TokenDAO';
    const validState = isMultisig ? 'PENDING' : (isTokenDAO ? 'QUEUED' : 'PENDING');

    if (currentState !== validState) {
      return res.status(400).json({
        error: `Cannot execute: DAO is not in ${validState} state`,
        currentState,
        hint: isTokenDAO ? 'Call /governance/queue first after voting ends' : undefined,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.daoId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.daoId,
        eventName: 'execute',
        payload: { agent: callerAddress },
        targetSequenceNumber,
      },
    };

    console.log(`[governance/execute] ${callerAddress} executing proposal on DAO ${input.daoId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      daoId: input.daoId,
      executor: callerAddress,
      proposalId: state.stateData?.proposal?.id,
      hash: result.hash,
      message: 'Proposal executed',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/execute] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Execute failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Delegate voting power
 * POST /governance/delegate
 */
governanceRoutes.post('/delegate', async (req, res) => {
  try {
    const input = DelegateRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    if (callerAddress === input.delegateTo) {
      return res.status(400).json({ error: 'Cannot delegate to yourself' });
    }

    const state = await getStateMachine(input.daoId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { allowDelegation?: boolean };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.daoId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.daoId,
        eventName: 'delegate',
        payload: {
          agent: callerAddress,
          delegateTo: input.delegateTo,
          weight: input.weight ?? 1,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[governance/delegate] ${callerAddress} delegating to ${input.delegateTo} in DAO ${input.daoId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      daoId: input.daoId,
      delegator: callerAddress,
      delegateTo: input.delegateTo,
      hash: result.hash,
      message: 'Delegation recorded',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/delegate] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Delegation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Veto a proposal (guardian only)
 * POST /governance/veto
 */
governanceRoutes.post('/veto', async (req, res) => {
  try {
    const input = VetoRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.daoId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { vetoers?: string[]; proposal?: { id: string; title: string } };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (state.currentState?.value !== 'PENDING') {
      return res.status(400).json({
        error: 'Veto only available during pending/veto period',
        currentState: state.currentState?.value,
      });
    }

    // Check if caller is authorized vetoer
    const vetoers = state.stateData?.vetoers ?? [];
    if (vetoers.length > 0 && !vetoers.includes(callerAddress)) {
      return res.status(403).json({
        error: 'Not authorized to veto',
        vetoers,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.daoId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.daoId,
        eventName: 'veto',
        payload: {
          agent: callerAddress,
          reason: input.reason,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[governance/veto] ${callerAddress} vetoing proposal in DAO ${input.daoId}`);
    console.log(`  Reason: ${input.reason}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      daoId: input.daoId,
      vetoer: callerAddress,
      proposalId: state.stateData?.proposal?.id,
      proposalTitle: state.stateData?.proposal?.title,
      reason: input.reason,
      hash: result.hash,
      message: 'Proposal vetoed',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[governance/veto] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Veto failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get DAO state
 * GET /governance/:daoId
 */
governanceRoutes.get('/:daoId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.daoId);
    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List proposals for a DAO
 * GET /governance/:daoId/proposals
 */
governanceRoutes.get('/:daoId/proposals', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.daoId) as {
      stateData?: {
        proposal?: unknown;
        executedProposals?: unknown[];
        rejectedProposals?: unknown[];
        cancelledProposals?: unknown[];
        vetoedProposals?: unknown[];
        actions?: unknown[];
      };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    const stateData = state.stateData ?? {};

    res.json({
      current: stateData.proposal ?? null,
      executed: stateData.executedProposals ?? stateData.actions ?? [],
      rejected: stateData.rejectedProposals ?? [],
      cancelled: stateData.cancelledProposals ?? [],
      vetoed: stateData.vetoedProposals ?? [],
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List all DAOs
 * GET /governance
 */
governanceRoutes.get('/', async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint() as {
      state: {
        stateMachines: Record<string, {
          stateData?: { schema?: string };
          definition?: { metadata?: { name?: string } };
        }>;
      };
    };

    // Filter state machines that are governance/DAO related
    const daos: Record<string, unknown> = {};
    const governanceSchemas = ['Governance', 'MultisigDAO', 'TokenDAO', 'ThresholdDAO', 'SingleDAO'];

    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      const schema = sm.stateData?.schema;
      const defName = sm.definition?.metadata?.name;

      if (
        governanceSchemas.includes(schema ?? '') ||
        governanceSchemas.includes(defName ?? '')
      ) {
        daos[fiberId] = sm;
      }
    }

    res.json({
      count: Object.keys(daos).length,
      daos,
    });
  } catch (err) {
    console.error('[governance/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
