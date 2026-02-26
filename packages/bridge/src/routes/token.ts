// Token management routes
// Implements the 4-bit TDEG (Transferable, Divisible, Expirable, Governable) token model
// for all 16 OttoChain token archetypes.
//
// Note: TDEG helpers are inlined here (TOKEN_BEHAVIOR_* constants, createTokenStateMachine)
// because @ottochain/sdk v1.0.3 does not yet export ./apps/token. When SDK ≥1.1.0 ships
// these should be replaced with:
//   import { createTokenStateMachine, TOKEN_BEHAVIOR_NAMES, isTransferable, ... }
//   from '@ottochain/sdk/apps/token';
//
// Spec: docs/design/bridge-token-route-spec.md
// Trello: https://trello.com/c/6996294a

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  submitTransaction,
  getStateMachine,
  getCheckpoint,
  keyPairFromPrivateKey,
  waitForFiber,
  getFiberSequenceNumber,
} from '../metagraph.js';

// ============================================================================
// Inlined TDEG helpers (source: @ottochain/sdk src/apps/token/)
// ============================================================================

const TOKEN_BEHAVIOR_FLAGS = {
  TRANSFERABLE: 0b1000,
  DIVISIBLE:    0b0100,
  EXPIRABLE:    0b0010,
  GOVERNABLE:   0b0001,
} as const;

const TOKEN_BEHAVIOR_NAMES: Record<number, string> = {
  0:  'SOULBOUND_RECEIPT',
  1:  'GOVERNED_BADGE',
  2:  'EXPIRABLE_CREDENTIAL',
  3:  'GOVERNED_LICENSE',
  4:  'LOYALTY_POINTS',
  5:  'GOVERNED_ALLOCATION',
  6:  'EXPIRABLE_POINTS',
  7:  'GOVERNED_EXPIRABLE_POINTS',
  8:  'NFT',
  9:  'GOVERNED_NFT',
  10: 'EXPIRABLE_NFT',
  11: 'GOVERNED_EXPIRABLE_NFT',
  12: 'FUNGIBLE_TOKEN',
  13: 'GOVERNED_FUNGIBLE_TOKEN',
  14: 'EXPIRABLE_FUNGIBLE_TOKEN',
  15: 'GOVERNED_EXPIRABLE_FUNGIBLE',
};

function isTransferable(b: number): boolean { return (b & TOKEN_BEHAVIOR_FLAGS.TRANSFERABLE) !== 0; }
function isDivisible(b: number): boolean     { return (b & TOKEN_BEHAVIOR_FLAGS.DIVISIBLE)    !== 0; }
function isExpirable(b: number): boolean     { return (b & TOKEN_BEHAVIOR_FLAGS.EXPIRABLE)    !== 0; }
function isGovernable(b: number): boolean    { return (b & TOKEN_BEHAVIOR_FLAGS.GOVERNABLE)   !== 0; }

type WireStateId = { value: string };
function sid(name: string): WireStateId { return { value: name }; }

const GOVERNANCE_GUARD = { var: 'delegation.isAuthorized' };
const EXPIRY_GUARD     = { '<': [{ var: '$ordinal' }, { var: 'state.expiresAtOrdinal' }] };
const SPLIT_GUARD      = { '<=': [{ var: 'event.amount' }, { var: 'state.balance' }] };

function transferGuard(g: boolean, e: boolean): unknown {
  if (g && e) return { and: [GOVERNANCE_GUARD, EXPIRY_GUARD] };
  if (g)      return GOVERNANCE_GUARD;
  if (e)      return EXPIRY_GUARD;
  return null;
}

function createTokenStateMachine(behavior: number) {
  const t = isTransferable(behavior);
  const d = isDivisible(behavior);
  const e = isExpirable(behavior);
  const g = isGovernable(behavior);
  const behaviorName = TOKEN_BEHAVIOR_NAMES[behavior] ?? `CUSTOM_${behavior}`;

  const states: Record<string, unknown> = {
    ACTIVE:  { id: sid('ACTIVE'),  isFinal: false, metadata: null },
    BURNED:  { id: sid('BURNED'),  isFinal: true,  metadata: null },
    ...(e ? { EXPIRED: { id: sid('EXPIRED'), isFinal: true, metadata: null } } : {}),
  };

  const transitions = [
    { from: sid('ACTIVE'), to: sid('BURNED'),  eventName: 'burn',     guard: null,                  effect: null },
    ...(t ? [{ from: sid('ACTIVE'), to: sid('ACTIVE'),  eventName: 'transfer', guard: transferGuard(g, e), effect: null }] : []),
    ...(d ? [{ from: sid('ACTIVE'), to: sid('ACTIVE'),  eventName: 'split',    guard: SPLIT_GUARD,          effect: null },
             { from: sid('ACTIVE'), to: sid('ACTIVE'),  eventName: 'merge',    guard: null,                  effect: null }] : []),
    ...(e ? [{ from: sid('ACTIVE'), to: sid('EXPIRED'), eventName: 'expire',   guard: null,                  effect: null }] : []),
  ];

  return {
    metadata: {
      name:          `Token_${behaviorName}`,
      description:   `OttoChain token — ${behaviorName.toLowerCase().replace(/_/g, ' ')}`,
      version:       '1.0.0',
      category:      'token',
      tokenBehavior: behavior,
    },
    states,
    initialState: sid('ACTIVE'),
    transitions,
  };
}

// ============================================================================
// Request Schemas
// ============================================================================

const CreateTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  behavior: z.number().int().min(0).max(15),
  owner: z.string().optional(),
  balance: z.number().positive().optional().default(1),
  metadata: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1).max(10).optional(),
    description: z.string().optional(),
    decimals: z.number().int().min(0).max(18).optional(),
    uri: z.string().url().optional(),
    attributes: z.record(z.any()).optional(),
  }),
  delegation: z.object({
    authorizedAgents: z.array(z.string()).optional(),
    multisigThreshold: z.number().int().min(1).optional(),
  }).optional(),
  expiresAtOrdinal: z.number().int().positive().optional(),
});

const TransferTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
  recipient: z.string(),
  amount: z.number().positive().optional(),
});

const SplitTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
  amount: z.number().positive(),
  childTokenId: z.string().uuid().optional(),
});

const MergeTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
  sourceTokenId: z.string().uuid(),
  amount: z.number().positive(),
});

const BurnTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
});

const ExpireTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
});

// ============================================================================
// Helper: fetch token state + validate behavior flag
// ============================================================================

type TokenState = {
  sequenceNumber?: number;
  currentState?: string;
  stateData?: {
    schema?: string;
    behavior?: number;
    owner?: string;
    balance?: number;
    status?: string;
    [key: string]: unknown;
  };
};

async function getTokenState(tokenId: string): Promise<TokenState | null> {
  return (await getStateMachine(tokenId)) as TokenState | null;
}

function requireBehaviorFlag(
  state: TokenState,
  flag: (b: number) => boolean,
  flagName: string,
): { error?: string } {
  const behavior = state.stateData?.behavior;
  if (typeof behavior !== 'number' || !flag(behavior)) {
    return { error: `Token behavior does not support ${flagName} (behavior=${behavior})` };
  }
  return {};
}

function requireActiveState(state: TokenState): { error?: string } {
  const current = state.currentState;
  if (current !== 'ACTIVE') {
    return { error: `Token is not in ACTIVE state (current: ${current})` };
  }
  return {};
}

// ============================================================================
// Routes
// ============================================================================

export const tokenRoutes: RouterType = Router();

/**
 * Create a new token state machine
 * POST /token/create
 */
tokenRoutes.post('/create', async (req, res) => {
  try {
    const input = CreateTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const tokenId = randomUUID();

    const behaviorName = TOKEN_BEHAVIOR_NAMES[input.behavior] ?? `CUSTOM_${input.behavior}`;
    const definition = createTokenStateMachine(input.behavior);

    const initialData = {
      schema: 'Token',
      behavior: input.behavior,
      behaviorName,
      owner: input.owner ?? keyPair.address,
      balance: input.balance,
      metadata: input.metadata,
      delegation: input.delegation ?? null,
      expiresAtOrdinal: input.expiresAtOrdinal ?? null,
      createdAt: new Date().toISOString(),
    };

    const message = {
      CreateStateMachine: {
        fiberId: tokenId,
        definition,
        initialData,
        parentFiberId: null,
      },
    };

    console.log(`[token/create] Creating ${behaviorName} token ${tokenId} for ${keyPair.address}`);
    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      tokenId,
      behavior: input.behavior,
      behaviorName,
      owner: input.owner ?? keyPair.address,
      hash: result.hash,
      message: `Token created in ACTIVE state (${behaviorName}).`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[token/create] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Token creation failed' });
  }
});

/**
 * Transfer token ownership (requires T=1)
 * POST /token/transfer
 */
tokenRoutes.post('/transfer', async (req, res) => {
  try {
    const input = TransferTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const visible = await waitForFiber(input.tokenId, 30, 1000);
    if (!visible) return res.status(503).json({ error: 'Token not yet synced', tokenId: input.tokenId });

    const state = await getTokenState(input.tokenId);
    if (!state) return res.status(404).json({ error: 'Token not found' });

    const flagCheck = requireBehaviorFlag(state, isTransferable, 'transfer (T=1)');
    if (flagCheck.error) return res.status(400).json(flagCheck);

    const stateCheck = requireActiveState(state);
    if (stateCheck.error) return res.status(400).json(stateCheck);

    const targetSequenceNumber = await getFiberSequenceNumber(input.tokenId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.tokenId,
        eventName: 'transfer',
        payload: {
          agent: keyPair.address,
          recipient: input.recipient,
          amount: input.amount ?? state.stateData?.balance,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[token/transfer] ${keyPair.address} → ${input.recipient} for token ${input.tokenId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      tokenId: input.tokenId,
      from: keyPair.address,
      to: input.recipient,
      amount: input.amount ?? state.stateData?.balance,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[token/transfer] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Transfer failed' });
  }
});

/**
 * Split a divisible token into parent + child (requires D=1)
 * POST /token/split
 */
tokenRoutes.post('/split', async (req, res) => {
  try {
    const input = SplitTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = await getTokenState(input.tokenId);
    if (!state) return res.status(404).json({ error: 'Token not found' });

    const flagCheck = requireBehaviorFlag(state, isDivisible, 'split (D=1)');
    if (flagCheck.error) return res.status(400).json(flagCheck);

    const stateCheck = requireActiveState(state);
    if (stateCheck.error) return res.status(400).json(stateCheck);

    const parentBalance = (state.stateData?.balance ?? 0) - input.amount;
    if (parentBalance < 0) {
      return res.status(400).json({ error: `Split amount ${input.amount} exceeds token balance ${state.stateData?.balance}` });
    }

    const childTokenId = input.childTokenId ?? randomUUID();
    const targetSequenceNumber = await getFiberSequenceNumber(input.tokenId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.tokenId,
        eventName: 'split',
        payload: {
          agent: keyPair.address,
          amount: input.amount,
          childTokenId,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[token/split] Splitting ${input.tokenId}: amount=${input.amount}, child=${childTokenId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      parentTokenId: input.tokenId,
      childTokenId,
      parentBalance,
      childBalance: input.amount,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[token/split] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Split failed' });
  }
});

/**
 * Merge source token into target (requires D=1 on both)
 * POST /token/merge
 */
tokenRoutes.post('/merge', async (req, res) => {
  try {
    const input = MergeTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const [targetState, sourceState] = await Promise.all([
      getTokenState(input.tokenId),
      getTokenState(input.sourceTokenId),
    ]);

    if (!targetState) return res.status(404).json({ error: 'Target token not found' });
    if (!sourceState) return res.status(404).json({ error: 'Source token not found' });

    const flagCheck = requireBehaviorFlag(targetState, isDivisible, 'merge (D=1)');
    if (flagCheck.error) return res.status(400).json(flagCheck);

    const stateCheck = requireActiveState(targetState);
    if (stateCheck.error) return res.status(400).json({ error: `Target token: ${stateCheck.error}` });

    const sourceStateCheck = requireActiveState(sourceState);
    if (sourceStateCheck.error) return res.status(400).json({ error: `Source token: ${sourceStateCheck.error}` });

    const targetSequenceNumber = await getFiberSequenceNumber(input.tokenId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.tokenId,
        eventName: 'merge',
        payload: {
          agent: keyPair.address,
          sourceTokenId: input.sourceTokenId,
          amount: input.amount,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[token/merge] Merging ${input.sourceTokenId} → ${input.tokenId}, amount=${input.amount}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      targetTokenId: input.tokenId,
      sourceTokenId: input.sourceTokenId,
      mergedAmount: input.amount,
      newBalance: (targetState.stateData?.balance ?? 0) + input.amount,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[token/merge] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Merge failed' });
  }
});

/**
 * Burn a token (always available, any behavior)
 * POST /token/burn
 */
tokenRoutes.post('/burn', async (req, res) => {
  try {
    const input = BurnTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = await getTokenState(input.tokenId);
    if (!state) return res.status(404).json({ error: 'Token not found' });

    const stateCheck = requireActiveState(state);
    if (stateCheck.error) return res.status(400).json(stateCheck);

    const targetSequenceNumber = await getFiberSequenceNumber(input.tokenId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.tokenId,
        eventName: 'burn',
        payload: { agent: keyPair.address },
        targetSequenceNumber,
      },
    };

    console.log(`[token/burn] Burning token ${input.tokenId} by ${keyPair.address}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      tokenId: input.tokenId,
      status: 'BURNED',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[token/burn] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Burn failed' });
  }
});

/**
 * Expire a token (requires E=1)
 * POST /token/expire
 */
tokenRoutes.post('/expire', async (req, res) => {
  try {
    const input = ExpireTokenRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);

    const state = await getTokenState(input.tokenId);
    if (!state) return res.status(404).json({ error: 'Token not found' });

    const flagCheck = requireBehaviorFlag(state, isExpirable, 'expire (E=1)');
    if (flagCheck.error) return res.status(400).json(flagCheck);

    const stateCheck = requireActiveState(state);
    if (stateCheck.error) return res.status(400).json(stateCheck);

    const targetSequenceNumber = await getFiberSequenceNumber(input.tokenId);

    const message = {
      TransitionStateMachine: {
        fiberId: input.tokenId,
        eventName: 'expire',
        payload: { agent: keyPair.address },
        targetSequenceNumber,
      },
    };

    console.log(`[token/expire] Expiring token ${input.tokenId}`);
    const result = await submitTransaction(message, input.privateKey);

    res.json({
      hash: result.hash,
      tokenId: input.tokenId,
      status: 'EXPIRED',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[token/expire] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Expire failed' });
  }
});

/**
 * Get token state by ID
 * GET /token/:tokenId
 */
tokenRoutes.get('/:tokenId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.tokenId);
    if (!state) return res.status(404).json({ error: 'Token not found' });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Query failed' });
  }
});

/**
 * List tokens with optional filters
 * GET /token?owner=DAG...&behavior=12&state=ACTIVE
 */
tokenRoutes.get('/', async (req, res) => {
  try {
    const { owner, behavior, state: tokenState } = req.query;
    const behaviorFilter = behavior !== undefined ? Number(behavior) : undefined;

    const checkpoint = (await getCheckpoint()) as {
      state: {
        stateMachines: Record<string, {
          currentState?: string;
          stateData?: {
            schema?: string;
            behavior?: number;
            owner?: string;
          };
          definition?: { metadata?: { category?: string } };
        }>;
      };
    };

    const tokens: Record<string, unknown> = {};
    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      const isToken =
        sm.stateData?.schema === 'Token' ||
        sm.definition?.metadata?.category === 'token';
      if (!isToken) continue;
      if (owner && sm.stateData?.owner !== owner) continue;
      if (behaviorFilter !== undefined && sm.stateData?.behavior !== behaviorFilter) continue;
      if (tokenState && sm.currentState !== tokenState) continue;
      tokens[fiberId] = sm;
    }

    res.json({
      count: Object.keys(tokens).length,
      tokens,
    });
  } catch (err) {
    console.error('[token/list] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'List failed' });
  }
});
