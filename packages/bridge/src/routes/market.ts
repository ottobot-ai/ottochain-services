// Market management routes
// Uses OttoChain metagraph state machines for on-chain markets
// Supports: predictions, auctions, crowdfunding, group buys

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { submitTransaction, getStateMachine, getCheckpoint, keyPairFromPrivateKey, waitForFiber, getFiberSequenceNumber } from '../metagraph.js';
import { MarketType, MarketState, getMarketDefinition } from '@ottochain/sdk/apps/markets';

export const marketRoutes: RouterType = Router();

// ============================================================================
// Proto-derived enums for validation
// ============================================================================

// Map proto enum to API-friendly lowercase strings
const MARKET_TYPE_MAP: Record<string, MarketType> = {
  prediction: MarketType.MARKET_TYPE_PREDICTION,
  auction: MarketType.MARKET_TYPE_AUCTION,
  crowdfund: MarketType.MARKET_TYPE_CROWDFUND,
  group_buy: MarketType.MARKET_TYPE_GROUP_BUY,
};

const MARKET_STATE_MAP: Record<MarketState, string> = {
  [MarketState.MARKET_STATE_UNSPECIFIED]: 'UNSPECIFIED',
  [MarketState.MARKET_STATE_PROPOSED]: 'PROPOSED',
  [MarketState.MARKET_STATE_OPEN]: 'OPEN',
  [MarketState.MARKET_STATE_CLOSED]: 'CLOSED',
  [MarketState.MARKET_STATE_RESOLVING]: 'RESOLVING',
  [MarketState.MARKET_STATE_SETTLED]: 'SETTLED',
  [MarketState.MARKET_STATE_REFUNDED]: 'REFUNDED',
  [MarketState.MARKET_STATE_CANCELLED]: 'CANCELLED',
  [MarketState.UNRECOGNIZED]: 'UNRECOGNIZED',
};

// ============================================================================
// Request Schemas (using proto-aligned types)
// ============================================================================

const MarketTypeSchema = z.enum(['prediction', 'auction', 'crowdfund', 'group_buy']);

const CreateMarketRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketType: MarketTypeSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  deadline: z.string().nullable().optional(),
  threshold: z.number().nullable().optional(),
  oracles: z.array(z.string()).optional().default([]),
  quorum: z.number().int().min(1).optional().default(1),
  terms: z.object({
    question: z.string().optional(),
    outcomes: z.array(z.string()).optional(),
    feePercent: z.number().optional(),
    item: z.string().optional(),
    reservePrice: z.number().optional(),
    buyNowPrice: z.number().nullable().optional(),
    goal: z.number().optional(),
    rewards: z.array(z.object({
      tier: z.string(),
      amount: z.number(),
      description: z.string(),
    })).optional(),
    allOrNothing: z.boolean().optional(),
    product: z.string().optional(),
    unitPrice: z.number().optional(),
    bulkPrice: z.number().optional(),
    minUnits: z.number().optional(),
  }).optional().default({}),
});

const OpenMarketRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
});

const CommitRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  amount: z.number().positive(),
  data: z.record(z.any()).optional().default({}),
});

const CloseMarketRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
});

const ResolveRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  outcome: z.string(),
  proof: z.string().optional(),
});

const FinalizeRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  outcome: z.string(),
  settlement: z.record(z.any()).optional(),
});

const ClaimRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  amount: z.number().optional(),
});

const RefundRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  reason: z.string().optional(),
});

const CancelRequestSchema = z.object({
  privateKey: z.string().length(64),
  marketId: z.string().uuid(),
  reason: z.string().optional(),
});

// ============================================================================

// ============================================================================
// Routes
// ============================================================================

/**
 * Create a new market
 * POST /market/create
 */
marketRoutes.post('/create', async (req, res) => {
  try {
    const input = CreateMarketRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;
    const marketId = randomUUID();

    // Map API type to proto enum for storage
    const protoMarketType = MARKET_TYPE_MAP[input.marketType];

    const initialData = {
      schema: 'Market',
      marketType: input.marketType,
      marketTypeProto: protoMarketType, // Store proto enum value for SDK compatibility
      creator: creatorAddress,
      title: input.title,
      description: input.description ?? '',
      terms: input.terms,
      deadline: input.deadline ?? null,
      threshold: input.threshold ?? null,
      oracles: input.oracles.length > 0 ? input.oracles : [creatorAddress],
      quorum: input.quorum,
      commitments: {},
      totalCommitted: 0,
      resolutions: [],
      claims: {},
      status: 'PROPOSED',
      statusProto: MarketState.MARKET_STATE_PROPOSED,
      createdAt: new Date().toISOString(),
    };

    const message = {
      CreateStateMachine: {
        fiberId: marketId,
        definition: getMarketDefinition(),
        initialData,
        parentFiberId: null,
      },
    };

    console.log(`[market/create] Creating ${input.marketType} market ${marketId} for ${creatorAddress}`);
    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      marketId,
      marketType: input.marketType,
      marketTypeProto: protoMarketType,
      creator: creatorAddress,
      hash: result.hash,
      message: 'Market created. Call /market/open to start accepting commitments.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/create] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Market creation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Open a market for commitments
 * POST /market/open
 */
marketRoutes.post('/open', async (req, res) => {
  try {
    const input = OpenMarketRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const visible = await waitForFiber(input.marketId, 30, 1000);
    if (!visible) {
      return res.status(503).json({
        error: 'Market not yet synced to data layer',
        marketId: input.marketId,
      });
    }

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'PROPOSED') {
      return res.status(400).json({
        error: 'Market cannot be opened',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'open',
        payload: { agent: keyPair.address },
        targetSequenceNumber,
      },
    };

    console.log(`[market/open] Opening market ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      status: 'OPEN',
      statusProto: MarketState.MARKET_STATE_OPEN,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/open] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Open failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Commit to a market (stake, bid, pledge, order)
 * POST /market/commit
 */
marketRoutes.post('/commit', async (req, res) => {
  try {
    const input = CommitRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'OPEN') {
      return res.status(400).json({
        error: 'Market is not open for commitments',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'commit',
        payload: {
          agent: keyPair.address,
          amount: input.amount,
          data: input.data,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/commit] ${keyPair.address} committing ${input.amount} to ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      amount: input.amount,
      participant: keyPair.address,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/commit] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Commitment failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Close a market for new commitments
 * POST /market/close
 */
marketRoutes.post('/close', async (req, res) => {
  try {
    const input = CloseMarketRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'OPEN') {
      return res.status(400).json({
        error: 'Market is not open',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'close',
        payload: { agent: keyPair.address },
        targetSequenceNumber,
      },
    };

    console.log(`[market/close] Closing market ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      status: 'CLOSED',
      statusProto: MarketState.MARKET_STATE_CLOSED,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/close] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Close failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Submit resolution for a market (oracle)
 * POST /market/resolve
 */
marketRoutes.post('/resolve', async (req, res) => {
  try {
    const input = ResolveRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (!['CLOSED', 'RESOLVING'].includes(state.stateData?.status ?? '')) {
      return res.status(400).json({
        error: 'Market cannot be resolved in current state',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'submit_resolution',
        payload: {
          agent: keyPair.address,
          outcome: input.outcome,
          proof: input.proof ?? null,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/resolve] ${keyPair.address} resolving ${input.marketId} with outcome: ${input.outcome}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      outcome: input.outcome,
      oracle: keyPair.address,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/resolve] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Resolution failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Finalize a market after resolution quorum
 * POST /market/finalize
 */
marketRoutes.post('/finalize', async (req, res) => {
  try {
    const input = FinalizeRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'RESOLVING') {
      return res.status(400).json({
        error: 'Market is not in resolving state',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'finalize',
        payload: {
          agent: keyPair.address,
          outcome: input.outcome,
          settlement: input.settlement ?? {},
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/finalize] Finalizing market ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      status: 'SETTLED',
      statusProto: MarketState.MARKET_STATE_SETTLED,
      outcome: input.outcome,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/finalize] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Finalize failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Claim winnings from a settled market
 * POST /market/claim
 */
marketRoutes.post('/claim', async (req, res) => {
  try {
    const input = ClaimRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as {
      sequenceNumber?: number;
      stateData?: {
        status?: string;
        commitments?: Record<string, { amount: number }>;
        claims?: Record<string, unknown>;
      };
    } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'SETTLED') {
      return res.status(400).json({
        error: 'Market is not settled',
        currentStatus: state.stateData?.status,
      });
    }

    const commitment = state.stateData?.commitments?.[keyPair.address];
    if (!commitment) {
      return res.status(400).json({ error: 'No commitment found for this address' });
    }

    if (state.stateData?.claims?.[keyPair.address]) {
      return res.status(400).json({ error: 'Already claimed' });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'claim',
        payload: {
          agent: keyPair.address,
          amount: input.amount ?? commitment.amount,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/claim] ${keyPair.address} claiming from ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      claimant: keyPair.address,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/claim] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Claim failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Refund a market (threshold not met or invalid resolution)
 * POST /market/refund
 */
marketRoutes.post('/refund', async (req, res) => {
  try {
    const input = RefundRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (!['CLOSED', 'RESOLVING'].includes(state.stateData?.status ?? '')) {
      return res.status(400).json({
        error: 'Market cannot be refunded in current state',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'refund',
        payload: {
          agent: keyPair.address,
          reason: input.reason ?? 'manual_refund',
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/refund] Refunding market ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      status: 'REFUNDED',
      statusProto: MarketState.MARKET_STATE_REFUNDED,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/refund] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Refund failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Cancel a market before opening
 * POST /market/cancel
 */
marketRoutes.post('/cancel', async (req, res) => {
  try {
    const input = CancelRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = (await getStateMachine(input.marketId)) as { sequenceNumber?: number; stateData?: { status?: string } } | null;
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (state.stateData?.status !== 'PROPOSED') {
      return res.status(400).json({
        error: 'Market can only be cancelled in PROPOSED state',
        currentStatus: state.stateData?.status,
      });
    }

    // Get sequence from DL1's onchain state (more reliable than ML0 for rapid transactions)
    const targetSequenceNumber = await getFiberSequenceNumber(input.marketId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.marketId,
        eventName: 'cancel',
        payload: {
          agent: keyPair.address,
          reason: input.reason ?? 'cancelled_by_creator',
        },
        targetSequenceNumber,
      },
    };

    console.log(`[market/cancel] Cancelling market ${input.marketId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      marketId: input.marketId,
      status: 'CANCELLED',
      statusProto: MarketState.MARKET_STATE_CANCELLED,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[market/cancel] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Cancel failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get market state by ID
 * GET /market/:marketId
 */
marketRoutes.get('/:marketId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.marketId);
    if (!state) {
      return res.status(404).json({ error: 'Market not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List all markets
 * GET /market
 * Query params: status, marketType
 */
marketRoutes.get('/', async (req, res) => {
  try {
    const { status, marketType } = req.query;
    const checkpoint = (await getCheckpoint()) as {
      state: {
        stateMachines: Record<string, {
          stateData?: { schema?: string; status?: string; marketType?: string };
          definition?: { metadata?: { name?: string } };
        }>;
      };
    };

    const markets: Record<string, unknown> = {};
    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      if (
        sm.stateData?.schema === 'Market' ||
        sm.definition?.metadata?.name === 'Market'
      ) {
        if (status && sm.stateData?.status !== status) continue;
        if (marketType && sm.stateData?.marketType !== marketType) continue;
        markets[fiberId] = sm;
      }
    }

    res.json({
      count: Object.keys(markets).length,
      markets,
    });
  } catch (err) {
    console.error('[market/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
