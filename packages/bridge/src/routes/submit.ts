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
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { relaySignedTransaction } from '../lib/metakit/relay.js';

export const submitRoutes: RouterType = Router();

// ============================================================================
// Request Schema
// ============================================================================

const ProofSchema = z.object({
  id: z.string(),
  signature: z.string(),
});

const SignedMessageSchema = z.object({
  value: z.record(z.any()),
  proofs: z.array(ProofSchema).min(1, 'At least one proof (signature) required'),
});

// ============================================================================
// POST /submit — Relay a pre-signed transaction to DL1
// ============================================================================

submitRoutes.post('/', async (req, res) => {
  try {
    const signed = SignedMessageSchema.parse(req.body);

    // Determine message type for the response
    const messageType = Object.keys(signed.value)[0] ?? 'unknown';

    const result = await relaySignedTransaction(signed);

    res.json({
      hash: result.hash,
      messageType,
      signers: signed.proofs.map((p) => p.id),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid signed message', details: err.errors });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: 'Relay failed', message });
    }
  }
});
