/**
 * Client-Side Signing Submit Route
 *
 * Accepts pre-signed transactions and relays them to DL1 nodes.
 * Part of Epic B: Client-Side Signing Refactor.
 *
 * Flow: client calls /build/* → signs locally → submits here
 *
 * Endpoint:
 *   POST /submit — accepts Signed<OttochainMessage>, relays to DL1
 *
 * Request formats accepted:
 *   Direct:  { value, proofs }
 *   Wrapped: { signed: { value, proofs } }   (SDK signTransaction() return shape)
 */

import { Router, type Router as RouterType } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { verify } from '@ottochain/sdk';
import { relaySignedTransaction } from '../lib/metakit/relay.js';

export const submitRoutes: RouterType = Router();

// ============================================================================
// Known OttoChain message types — imported from SDK
// ============================================================================

import { OTTOCHAIN_MESSAGE_TYPES } from '@ottochain/sdk';

/**
 * Runtime set of valid message types.
 * Imported from SDK to stay in sync automatically.
 */
const KNOWN_MESSAGE_TYPES = new Set<string>(OTTOCHAIN_MESSAGE_TYPES);

// ============================================================================
// Request Schemas
// ============================================================================

const ProofSchema = z.object({
  id: z.string(),
  signature: z.string(),
});

// The signed payload itself: { value: Record<string, any>, proofs: [...] }
const SignedPayloadSchema = z.object({
  value: z.record(z.any()),
  proofs: z.array(ProofSchema).min(1, 'At least one proof (signature) required'),
});

// Accept both direct and wrapped formats:
//   Direct:  { value, proofs }
//   Wrapped: { signed: { value, proofs } }
const SubmitBodySchema = z.union([
  // Wrapped: { signed: { value, proofs } }
  z.object({
    signed: SignedPayloadSchema,
  }).transform((body) => body.signed),
  // Direct: { value, proofs }
  SignedPayloadSchema,
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract fiberId from the message value if present.
 * Handles CreateStateMachine and TransitionStateMachine.
 */
function extractFiberId(value: Record<string, unknown>): string | undefined {
  for (const messageBody of Object.values(value)) {
    if (typeof messageBody === 'object' && messageBody !== null) {
      const body = messageBody as Record<string, unknown>;
      if (typeof body['fiberId'] === 'string') {
        return body['fiberId'];
      }
    }
  }
  return undefined;
}

// ============================================================================
// Rate limiter — prevent abuse of the public submit endpoint
// ============================================================================

const submitRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,           // max 30 submissions per IP per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down and try again shortly.' },
});

// ============================================================================
// POST /submit — Relay a pre-signed transaction to DL1
// ============================================================================

submitRoutes.post('/', submitRateLimiter, async (req, res) => {
  // Parse and normalize request body (direct or wrapped format)
  const parseResult = SubmitBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid signed message', details: parseResult.error.errors });
    return;
  }

  const signed = parseResult.data;

  // Determine message type from the value key
  const messageType = Object.keys(signed.value)[0] ?? 'unknown';

  // Validate message type is a known OttoChain type
  if (!KNOWN_MESSAGE_TYPES.has(messageType)) {
    res.status(400).json({
      error: 'Unknown message type',
      messageType,
      message: `Unrecognized message type: ${messageType}. Must be a valid OttochainMessage type.`,
    });
    return;
  }

  // Verify signature(s) before relaying — prevents relaying garbage to DL1
  // signTransaction() uses signDataUpdate (isDataUpdate=true)
  const verification = verify(signed, true);
  if (!verification.isValid) {
    res.status(422).json({
      error: 'Signature verification failed',
      message: `${verification.invalidProofs.length} of ${signed.proofs.length} proof(s) failed verification`,
      invalidProofIds: verification.invalidProofs.map((p) => p.id),
    });
    return;
  }

  // Relay to DL1
  try {
    const result = await relaySignedTransaction(signed);

    const fiberId = extractFiberId(signed.value);

    res.json({
      hash: result.hash,
      messageType,
      signers: signed.proofs.map((p) => p.id),
      ...(fiberId !== undefined ? { fiberId } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Relay failed', message });
  }
});
