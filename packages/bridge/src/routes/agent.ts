// Agent registration and management routes

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getConfig } from '@ottochain/shared';
import { submitTransaction } from '../metagraph.js';

export const agentRoutes: RouterType = Router();

const RegisterRequestSchema = z.object({
  address: z.string(),
  publicKey: z.string(),
  displayName: z.string().optional(),
  platform: z.string(),
  platformUserId: z.string(),
  platformUsername: z.string().optional(),
  signature: z.string(),
});

const VouchRequestSchema = z.object({
  fromAddress: z.string(),
  toAddress: z.string(),
  reason: z.string().optional(),
  signature: z.string(),
});

/**
 * Register a new agent
 * POST /agent/register
 */
agentRoutes.post('/register', async (req, res) => {
  try {
    const body = RegisterRequestSchema.parse(req.body);
    
    // Build CreateStateMachine message for AgentIdentity
    const message = {
      CreateStateMachine: {
        definition: {
          schema: 'AgentIdentity',
          initialState: 'registered',
          initialData: {
            address: body.address,
            publicKey: body.publicKey,
            displayName: body.displayName,
            reputation: 10,
            platforms: [{
              platform: body.platform,
              userId: body.platformUserId,
              username: body.platformUsername,
            }],
            attestations: [],
          },
          states: ['registered', 'active', 'withdrawn'],
          transitions: [
            { from: 'registered', to: 'active', action: 'activate' },
            { from: 'active', to: 'active', action: 'attest_completion' },
            { from: 'active', to: 'active', action: 'attest_vouch' },
            { from: 'active', to: 'active', action: 'attest_violation' },
            { from: 'active', to: 'withdrawn', action: 'withdraw' },
          ],
        },
        owner: body.address,
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
      address: body.address,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Submit a vouch attestation
 * POST /agent/vouch
 */
agentRoutes.post('/vouch', async (req, res) => {
  try {
    const body = VouchRequestSchema.parse(req.body);
    
    // Build TriggerTransition message for vouch
    const message = {
      TriggerTransition: {
        fiberId: body.toAddress, // Need to lookup fiberId from address
        action: 'attest_vouch',
        input: {
          issuerAddress: body.fromAddress,
          type: 'VOUCH',
          delta: 2,
          reason: body.reason,
        },
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
    });
  } catch (err) {
    console.error('Vouch error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Link additional platform
 * POST /agent/link
 */
agentRoutes.post('/link', async (req, res) => {
  // TODO: Implement platform linking
  res.status(501).json({ error: 'Not implemented' });
});
