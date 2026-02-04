// Wallet management routes

import { Router, type Router as RouterType } from 'express';
import { generateKeyPair, keyPairFromPrivateKey } from '../metagraph.js';
import { signDataUpdate } from '../lib/metakit/index.js';

export const walletRoutes: RouterType = Router();

/**
 * Generate a new keypair
 * POST /wallet/generate
 */
walletRoutes.post('/generate', (_, res) => {
  const keyPair = generateKeyPair();

  res.json({
    address: keyPair.address,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    warning: 'Store the private key securely. It cannot be recovered.',
  });
});

/**
 * Derive keypair from existing private key
 * POST /wallet/import
 */
walletRoutes.post('/import', (req, res) => {
  const { privateKey } = req.body;

  if (!privateKey || typeof privateKey !== 'string') {
    return res.status(400).json({ error: 'privateKey is required' });
  }

  if (privateKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKey)) {
    return res.status(400).json({ error: 'Invalid private key format (expected 64 hex characters)' });
  }

  try {
    const keyPair = keyPairFromPrivateKey(privateKey);
    res.json({
      address: keyPair.address,
      publicKey: keyPair.publicKey,
    });
  } catch (err) {
    res.status(400).json({ error: 'Failed to derive keypair from private key' });
  }
});

/**
 * Sign a message (for client-side transaction building)
 * POST /wallet/sign
 * 
 * Body: { message: {...}, privateKey: "hex" }
 * Returns: { proof: { id, signature } }
 */
walletRoutes.post('/sign', async (req, res) => {
  const { message, privateKey } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!privateKey || typeof privateKey !== 'string') {
    return res.status(400).json({ error: 'privateKey is required' });
  }

  try {
    const proof = await signDataUpdate(message, privateKey);
    res.json({ proof });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Signing failed';
    res.status(400).json({ error: errorMessage });
  }
});

/**
 * Verify an address matches a public key
 * POST /wallet/verify-address
 */
walletRoutes.post('/verify-address', (req, res) => {
  const { publicKey, expectedAddress } = req.body;

  if (!publicKey || !expectedAddress) {
    return res.status(400).json({ error: 'publicKey and expectedAddress are required' });
  }

  try {
    // Import to derive address
    const { address } = keyPairFromPrivateKey(publicKey);
    const matches = address === expectedAddress;
    res.json({ matches, derivedAddress: address });
  } catch {
    res.status(400).json({ error: 'Invalid public key' });
  }
});
