// Agent registration and management routes
// Uses OttoChain metagraph state machines for on-chain identity
// Supports two signing modes: server-signed and self-signed

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  submitTransaction,
  getStateMachine,
  getCheckpoint,
  keyPairFromPrivateKey,
  generateKeyPair,
  waitForFiber,
  getFiberSequenceNumber,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';
import { getIdentityDefinition, DEFAULT_REPUTATION_CONFIG } from '@ottochain/sdk/apps/identity';
import { batchSign, type Signed, type SignatureProof } from '@ottochain/sdk';
import {
  getKeyStore,
  registerServerSigned,
  registerSelfSigned,
  getSigningKey,
  validateSelfSignedOwnership,
  type SigningMode,
} from '../lib/metakit/key-store.js';
import { relaySignedTransaction } from '../lib/metakit/relay.js';
import { toProtoDefinition } from '@ottochain/sdk';

const AGENT_IDENTITY_DEFINITION = toProtoDefinition(getIdentityDefinition('agent'));

// TODO: Implement per-fiber rate limiting (see docs/specs/signing-modes-spec.md)
export const agentRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

// Base metadata (shared between modes)
const AgentMetadataSchema = z.object({
  displayName: z.string().optional(),
  platform: z.string().optional(),
  platformUserId: z.string().optional(),
});

// Server-signed registration: bridge generates and stores keys
const RegisterServerSignedSchema = AgentMetadataSchema.extend({
  signingMode: z.literal('server'),
});

// Self-signed registration: client provides their public key
const RegisterSelfSignedSchema = AgentMetadataSchema.extend({
  signingMode: z.literal('self'),
  publicKey: z.string().length(128).regex(/^[0-9a-fA-F]+$/, 'Public key must be 128 hex characters'),
});

// Combined registration schema
const RegisterRequestSchema = z.discriminatedUnion('signingMode', [
  RegisterServerSignedSchema,
  RegisterSelfSignedSchema,
]);

// Legacy registration (deprecated) - privateKey in request
const LegacyRegisterRequestSchema = AgentMetadataSchema.extend({
  privateKey: z.string().length(64),
});

// Signature proof schema
const SignatureProofSchema = z.object({
  id: z.string().length(128),
  signature: z.string().min(100),
});

// Signed update schema for self-signed mode
const SignedUpdateSchema = z.object({
  value: z.record(z.any()),
  proofs: z.array(SignatureProofSchema).min(1),
});

// Server-signed transition: bridge signs with stored key
const TransitionServerSignedSchema = z.object({
  fiberId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.any()).optional(),
});

// Self-signed transition: client provides pre-signed update
const TransitionSelfSignedSchema = z.object({
  fiberId: z.string().uuid(),
  signedUpdate: SignedUpdateSchema,
});

// Legacy transition (deprecated)
const LegacyTransitionRequestSchema = z.object({
  privateKey: z.string().length(64),
  fiberId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.any()).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine if a registration request is using legacy format
 */
function isLegacyRegistration(body: unknown): body is z.infer<typeof LegacyRegisterRequestSchema> {
  return typeof body === 'object' && body !== null && 'privateKey' in body && !('signingMode' in body);
}

/**
 * Determine if a transition request is using legacy format
 */
function isLegacyTransition(body: unknown): body is z.infer<typeof LegacyTransitionRequestSchema> {
  return typeof body === 'object' && body !== null && 'privateKey' in body;
}

/**
 * Submit a transaction using server-signed mode
 */
async function submitServerSigned(
  fiberId: string,
  message: TransitionStateMachine | CreateStateMachine | object
): Promise<{ hash: string }> {
  const privateKey = await getSigningKey(fiberId);
  return submitTransaction(message, privateKey);
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Generate a new wallet
 * POST /agent/wallet
 */
agentRoutes.post('/wallet', async (_req, res) => {
  try {
    const keyPair = generateKeyPair();
    res.json({
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      address: keyPair.address,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Wallet generation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Register a new agent identity
 * POST /agent/register
 *
 * Supports two modes:
 * - server: Bridge generates and stores keys, signs on agent's behalf
 * - self: Agent provides public key, submits pre-signed transactions
 *
 * Also supports deprecated legacy format (privateKey in request) for backward compat.
 */
agentRoutes.post('/register', async (req, res) => {
  try {
    // Check for legacy format
    if (isLegacyRegistration(req.body)) {
      console.warn('[agent/register] DEPRECATED: Using privateKey in request. Migrate to signingMode API.');

      const input = LegacyRegisterRequestSchema.parse(req.body);
      const keyPair = keyPairFromPrivateKey(input.privateKey);
      const ownerAddress = keyPair.address;
      const fiberId = randomUUID();

      // Store the key in server mode (treating legacy as server-signed)
      const store = getKeyStore();
      await store.set(fiberId, input.privateKey);
      await store.setMetadata(fiberId, {
        signingMode: 'server',
        publicKey: keyPair.publicKey,
        address: ownerAddress,
        createdAt: new Date(),
      });

      const message = {
        CreateStateMachine: {
          fiberId,
          definition: AGENT_IDENTITY_DEFINITION,
          initialData: {
            schema: 'AgentIdentity',
            displayName: input.displayName ?? null,
            platform: input.platform ?? null,
            platformUserId: input.platformUserId ?? null,
            owner: ownerAddress,
            reputation: DEFAULT_REPUTATION_CONFIG.baseReputation,
            vouches: [],
            completedContracts: 0,
            violations: 0,
            status: 'REGISTERED',
            createdAt: new Date().toISOString(),
          },
          parentFiberId: null,
        },
      };

      console.log(`[agent/register] Creating AgentIdentity fiber ${fiberId} for ${ownerAddress} (legacy mode)`);
      const result = await submitTransaction(message, input.privateKey);

      return res.status(201).json({
        fiberId,
        address: ownerAddress,
        publicKey: keyPair.publicKey,
        signingMode: 'server' as SigningMode,
        hash: result.hash,
        message: 'Agent identity created. Call /agent/activate to activate.',
        _deprecated: 'Using privateKey in requests is deprecated. Use signingMode: "server" or "self" instead.',
      });
    }

    // New format with signingMode
    const input = RegisterRequestSchema.parse(req.body);
    const fiberId = randomUUID();

    let ownerAddress: string;
    let publicKey: string;
    let privateKeyForTx: string;

    if (input.signingMode === 'server') {
      // Server-signed: generate and store keys
      const registration = await registerServerSigned(fiberId);
      ownerAddress = registration.keyPair.address;
      publicKey = registration.keyPair.publicKey;
      privateKeyForTx = registration.keyPair.privateKey;
    } else {
      // Self-signed CreateStateMachine requires multi-party signing support (Epic A)
      // Until then, the relay key signer won't match the owner address → DL1 rejection
      // For now, register metadata only and return fiberId for future use
      const registration = await registerSelfSigned(fiberId, input.publicKey);

      console.log(`[agent/register] Self-signed registration for ${registration.address} — metadata only (pending multi-party signing)`);

      return res.status(201).json({
        fiberId,
        address: registration.address,
        publicKey: input.publicKey,
        signingMode: input.signingMode,
        status: 'pending_metagraph',
        message: 'Agent identity registered with bridge. On-chain fiber creation requires multi-party signing support (not yet available). Use this fiberId for future operations once Epic A lands.',
      });
    }

    const message = {
      CreateStateMachine: {
        fiberId,
        definition: AGENT_IDENTITY_DEFINITION,
        initialData: {
          schema: 'AgentIdentity',
          displayName: input.displayName ?? null,
          platform: input.platform ?? null,
          platformUserId: input.platformUserId ?? null,
          owner: ownerAddress,
          reputation: DEFAULT_REPUTATION_CONFIG.baseReputation,
          vouches: [],
          completedContracts: 0,
          violations: 0,
          status: 'REGISTERED',
          createdAt: new Date().toISOString(),
        },
        parentFiberId: null,
      },
    };

    console.log(`[agent/register] Creating AgentIdentity fiber ${fiberId} for ${ownerAddress} (${input.signingMode} mode)`);
    const result = await submitTransaction(message, privateKeyForTx);

    res.status(201).json({
      fiberId,
      address: ownerAddress,
      publicKey,
      signingMode: input.signingMode,
      hash: result.hash,
      message: 'Agent identity created. Call /agent/activate to activate.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent/register] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Registration failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Transition an agent's state machine
 * POST /agent/transition
 *
 * Supports:
 * - Server-signed: { fiberId, event, payload } - bridge signs
 * - Self-signed: { fiberId, signedUpdate: { value, proofs } } - client pre-signed
 * - Legacy: { privateKey, fiberId, event, payload } - deprecated
 */
agentRoutes.post('/transition', async (req, res) => {
  try {
    // Check for legacy format
    if (isLegacyTransition(req.body)) {
      console.warn('[agent/transition] DEPRECATED: Using privateKey in request. Migrate to signingMode API.');

      const input = LegacyTransitionRequestSchema.parse(req.body);

      const state = await getStateMachine(input.fiberId) as { sequenceNumber?: number } | null;
      if (!state) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const targetSequenceNumber = await getFiberSequenceNumber(input.fiberId);
      const message = {
        TransitionStateMachine: {
          fiberId: input.fiberId,
          eventName: input.event,
          payload: input.payload ?? {},
          targetSequenceNumber,
        },
      };

      console.log(`[agent/transition] Event ${input.event} on fiber ${input.fiberId} (legacy)`);
      const result = await submitTransaction(message, input.privateKey);

      return res.json({
        hash: result.hash,
        event: input.event,
        fiberId: input.fiberId,
        _deprecated: 'Using privateKey in requests is deprecated.',
      });
    }

    // Check for self-signed format
    const selfSignedParse = TransitionSelfSignedSchema.safeParse(req.body);
    if (selfSignedParse.success) {
      const input = selfSignedParse.data;

      // Validate ownership
      const signerPublicKey = input.signedUpdate.proofs[0]?.id;
      if (!signerPublicKey) {
        return res.status(400).json({ error: 'No signature proof provided' });
      }

      const validation = await validateSelfSignedOwnership(input.fiberId, signerPublicKey);
      if (!validation.valid) {
        return res.status(403).json({ error: validation.error });
      }

      console.log(`[agent/transition] Relaying self-signed update for fiber ${input.fiberId}`);
      const result = await relaySignedTransaction(input.signedUpdate as { value: unknown; proofs: unknown[] });
      return res.json({
        hash: result.hash,
        fiberId: input.fiberId,
        signingMode: 'self',
      });
    }

    // Server-signed format
    const input = TransitionServerSignedSchema.parse(req.body);

    // Check signing mode
    const store = getKeyStore();
    const mode = await store.getMode(input.fiberId);

    if (mode === 'self') {
      return res.status(400).json({
        error: 'Fiber is in self-signed mode. Submit signedUpdate with pre-signed transaction.',
        signingMode: 'self',
      });
    }

    const state = await getStateMachine(input.fiberId) as { sequenceNumber?: number } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(input.fiberId);
    const message = {
      TransitionStateMachine: {
        fiberId: input.fiberId,
        eventName: input.event,
        payload: input.payload ?? {},
        targetSequenceNumber,
      },
    };

    console.log(`[agent/transition] Event ${input.event} on fiber ${input.fiberId} (server-signed)`);

    const privateKey = await getSigningKey(input.fiberId);
    const result = await submitTransaction(message, privateKey);

    res.json({
      hash: result.hash,
      event: input.event,
      fiberId: input.fiberId,
      signingMode: 'server',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent/transition] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transition failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Activate an agent (shorthand for transition with activate event)
 * POST /agent/activate
 */
agentRoutes.post('/activate', async (req, res) => {
  try {
    const { fiberId, waitForSync = true, maxWaitSeconds = 30, signedUpdate, privateKey } = req.body;

    if (!fiberId) {
      return res.status(400).json({ error: 'fiberId is required' });
    }

    // Wait for fiber to appear in state before activating
    if (waitForSync) {
      const fiberVisible = await waitForFiber(fiberId, maxWaitSeconds, 1000);
      if (!fiberVisible) {
        return res.status(503).json({
          error: 'Fiber not yet synced to data layer',
          fiberId,
          hint: 'Try again in a few seconds or set waitForSync=false to skip waiting'
        });
      }
    }

    const state = await getStateMachine(fiberId) as { sequenceNumber?: number; currentState?: string } | null;
    if (!state) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (state.currentState !== 'REGISTERED') {
      return res.status(400).json({
        error: 'Agent cannot be activated',
        currentState: state.currentState
      });
    }

    // Handle self-signed activation
    if (signedUpdate) {
      const signerPublicKey = signedUpdate.proofs?.[0]?.id;
      if (!signerPublicKey) {
        return res.status(400).json({ error: 'No signature proof provided' });
      }

      const validation = await validateSelfSignedOwnership(fiberId, signerPublicKey);
      if (!validation.valid) {
        return res.status(403).json({ error: validation.error });
      }

      const result = await relaySignedTransaction(signedUpdate as { value: unknown; proofs: unknown[] });
      return res.json({
        hash: result.hash,
        fiberId,
        status: 'ACTIVE',
        signingMode: 'self',
      });
    }

    // Handle legacy privateKey
    if (privateKey) {
      console.warn('[agent/activate] DEPRECATED: Using privateKey in request.');

      const targetSequenceNumber = await getFiberSequenceNumber(fiberId);
      const message = {
        TransitionStateMachine: {
          fiberId,
          eventName: 'activate',
          payload: {},
          targetSequenceNumber,
        },
      };

      const result = await submitTransaction(message, privateKey);
      return res.json({
        hash: result.hash,
        fiberId,
        status: 'ACTIVE',
        _deprecated: 'Using privateKey in requests is deprecated.',
      });
    }

    // Server-signed activation
    const store = getKeyStore();
    const mode = await store.getMode(fiberId);

    if (mode === 'self') {
      return res.status(400).json({
        error: 'Fiber is in self-signed mode. Provide signedUpdate.',
        signingMode: 'self',
      });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(fiberId);
    const message = {
      TransitionStateMachine: {
        fiberId,
        eventName: 'activate',
        payload: {},
        targetSequenceNumber,
      },
    };

    console.log(`[agent/activate] Activating fiber ${fiberId} (server-signed)`);
    const privateKeyStored = await getSigningKey(fiberId);
    const result = await submitTransaction(message, privateKeyStored);

    res.json({
      hash: result.hash,
      fiberId,
      status: 'ACTIVE',
      signingMode: 'server',
    });
  } catch (err) {
    console.error('[agent/activate] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Activation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Vouch for another agent
 * POST /agent/vouch
 */
agentRoutes.post('/vouch', async (req, res) => {
  try {
    const { fiberId, targetFiberId, fromAddress, reason, signedUpdate, privateKey } = req.body;

    if (!targetFiberId) {
      return res.status(400).json({ error: 'targetFiberId is required' });
    }

    const state = await getStateMachine(targetFiberId) as { sequenceNumber?: number; currentState?: string } | null;
    if (!state) {
      return res.status(404).json({ error: 'Target agent not found' });
    }

    if (state.currentState !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Can only vouch for active agents',
        currentState: state.currentState
      });
    }

    // Handle self-signed vouch
    if (signedUpdate) {
      // For vouch, we need fiberId of the voucher, not target
      if (!fiberId) {
        return res.status(400).json({ error: 'fiberId (voucher) is required for self-signed vouch' });
      }

      const signerPublicKey = signedUpdate.proofs?.[0]?.id;
      if (!signerPublicKey) {
        return res.status(400).json({ error: 'No signature proof provided' });
      }

      const validation = await validateSelfSignedOwnership(fiberId, signerPublicKey);
      if (!validation.valid) {
        return res.status(403).json({ error: validation.error });
      }

      const result = await relaySignedTransaction(signedUpdate as { value: unknown; proofs: unknown[] });
      return res.json({
        hash: result.hash,
        event: 'vouch',
        targetFiberId,
        signingMode: 'self',
      });
    }

    // Handle legacy privateKey
    if (privateKey) {
      console.warn('[agent/vouch] DEPRECATED: Using privateKey in request.');

      const voucherAddress = fromAddress ?? keyPairFromPrivateKey(privateKey).address;
      const targetSequenceNumber = await getFiberSequenceNumber(targetFiberId);

      const message = {
        TransitionStateMachine: {
          fiberId: targetFiberId,
          eventName: 'receive_vouch',
          payload: { from: voucherAddress, reason: reason ?? '' },
          targetSequenceNumber,
        },
      };

      const result = await submitTransaction(message, privateKey);
      return res.json({
        hash: result.hash,
        event: 'vouch',
        targetFiberId,
        from: voucherAddress,
        _deprecated: 'Using privateKey in requests is deprecated.',
      });
    }

    // Server-signed vouch
    if (!fiberId) {
      return res.status(400).json({ error: 'fiberId (voucher) is required for server-signed vouch' });
    }

    const store = getKeyStore();
    const mode = await store.getMode(fiberId);

    if (mode === 'self') {
      return res.status(400).json({
        error: 'Voucher fiber is in self-signed mode. Provide signedUpdate.',
        signingMode: 'self',
      });
    }

    const metadata = await store.getMetadata(fiberId);
    const voucherAddress = fromAddress ?? metadata?.address;

    if (!voucherAddress) {
      return res.status(400).json({ error: 'Could not determine voucher address' });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(targetFiberId);
    const message = {
      TransitionStateMachine: {
        fiberId: targetFiberId,
        eventName: 'receive_vouch',
        payload: { from: voucherAddress, reason: reason ?? '' },
        targetSequenceNumber,
      },
    };

    console.log(`[agent/vouch] ${voucherAddress} vouching for ${targetFiberId} (server-signed)`);
    const voucherKey = await getSigningKey(fiberId);
    const result = await submitTransaction(message, voucherKey);

    res.json({
      hash: result.hash,
      event: 'vouch',
      targetFiberId,
      from: voucherAddress,
      signingMode: 'server',
    });
  } catch (err) {
    console.error('[agent/vouch] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Vouch failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Agent Discovery
// ============================================================================

import { discoverAgents, type RawAgentStateMachine } from '../lib/agent-discovery.js';

const DiscoverQuerySchema = z.object({
  capability: z.string().optional(),
  minReputation: z.coerce.number().min(0).default(0),
  state: z.string().default('ACTIVE'),
  limit: z.coerce.number().min(1).max(50).default(10),
});

/**
 * Discover agents by capability and reputation
 * GET /agent/discover?capability=research&minReputation=5&state=ACTIVE&limit=10
 */
agentRoutes.get('/discover', async (req, res) => {
  try {
    const query = DiscoverQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: query.error.flatten() });
    }

    const checkpoint = await getCheckpoint() as {
      state: { stateMachines: Record<string, RawAgentStateMachine> };
    };

    const result = discoverAgents(checkpoint.state.stateMachines ?? {}, query.data);

    res.json({ ...result, query: query.data });
  } catch (err) {
    console.error('[agent/discover] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Discovery failed';
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

    // Include signing mode if known
    const store = getKeyStore();
    const metadata = await store.getMetadata(req.params.fiberId);

    res.json({
      ...state as object,
      _signingMode: metadata?.signingMode ?? 'unknown',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List all agents (from metagraph checkpoint)
 * GET /agent
 */
agentRoutes.get('/', async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint() as {
      state: {
        stateMachines: Record<string, {
          stateData?: { schema?: string };
          definition?: { metadata?: { name?: string } };
        }>
      }
    };

    // Filter state machines that are AgentIdentity
    const agents: Record<string, unknown> = {};
    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      if (
        sm.stateData?.schema === 'AgentIdentity' ||
        sm.definition?.metadata?.name === 'AgentIdentity'
      ) {
        agents[fiberId] = sm;
      }
    }

    res.json({
      count: Object.keys(agents).length,
      agents,
    });
  } catch (err) {
    console.error('[agent/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});


