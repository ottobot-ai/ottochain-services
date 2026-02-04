// Wallet management routes

import { Router, type Router as RouterType } from 'express';
import nacl from 'tweetnacl';

export const walletRoutes: RouterType = Router();

/**
 * Generate a new keypair
 * POST /wallet/generate
 */
walletRoutes.post('/generate', (_, res) => {
  const keypair = nacl.sign.keyPair();
  
  const publicKey = Buffer.from(keypair.publicKey).toString('hex');
  const secretKey = Buffer.from(keypair.secretKey).toString('hex');
  
  // DAG address is derived from public key (simplified - real implementation uses hash)
  const address = `DAG${publicKey.slice(0, 40)}`;
  
  res.json({
    address,
    publicKey,
    secretKey, // In production, this should be encrypted or returned only once
  });
});

/**
 * Sign a message
 * POST /wallet/sign
 */
walletRoutes.post('/sign', (req, res) => {
  const { message, secretKey } = req.body;
  
  if (!message || !secretKey) {
    return res.status(400).json({ error: 'Missing message or secretKey' });
  }
  
  try {
    const secretKeyBytes = Buffer.from(secretKey, 'hex');
    const messageBytes = Buffer.from(message, 'utf-8');
    
    const signature = nacl.sign.detached(messageBytes, secretKeyBytes);
    
    res.json({
      signature: Buffer.from(signature).toString('hex'),
    });
  } catch (err) {
    res.status(400).json({ error: 'Invalid secretKey' });
  }
});

/**
 * Verify a signature
 * POST /wallet/verify
 */
walletRoutes.post('/verify', (req, res) => {
  const { message, signature, publicKey } = req.body;
  
  if (!message || !signature || !publicKey) {
    return res.status(400).json({ error: 'Missing message, signature, or publicKey' });
  }
  
  try {
    const publicKeyBytes = Buffer.from(publicKey, 'hex');
    const signatureBytes = Buffer.from(signature, 'hex');
    const messageBytes = Buffer.from(message, 'utf-8');
    
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    
    res.json({ valid });
  } catch (err) {
    res.json({ valid: false });
  }
});
