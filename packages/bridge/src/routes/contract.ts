// Contract management routes

import { Router } from 'express';
import { z } from 'zod';
import { submitTransaction } from '../metagraph.js';

export const contractRoutes = Router();

const ProposeRequestSchema = z.object({
  proposerAddress: z.string(),
  counterpartyAddress: z.string(),
  terms: z.record(z.any()),
  signature: z.string(),
});

const ContractActionSchema = z.object({
  contractId: z.string(),
  agentAddress: z.string(),
  proof: z.string().optional(),
  signature: z.string(),
});

/**
 * Propose a new contract
 * POST /contract/propose
 */
contractRoutes.post('/propose', async (req, res) => {
  try {
    const body = ProposeRequestSchema.parse(req.body);
    
    const contractId = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Build CreateStateMachine message for Contract
    const message = {
      CreateStateMachine: {
        definition: {
          schema: 'Contract',
          initialState: 'proposed',
          initialData: {
            contractId,
            proposerAddress: body.proposerAddress,
            counterpartyAddress: body.counterpartyAddress,
            terms: body.terms,
            proposedAt: new Date().toISOString(),
          },
          states: ['proposed', 'active', 'completed', 'rejected', 'disputed'],
          transitions: [
            { from: 'proposed', to: 'active', action: 'accept' },
            { from: 'proposed', to: 'rejected', action: 'reject' },
            { from: 'active', to: 'completed', action: 'complete' },
            { from: 'active', to: 'disputed', action: 'dispute' },
          ],
        },
        owner: body.proposerAddress,
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
      contractId,
    });
  } catch (err) {
    console.error('Propose error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Accept a contract proposal
 * POST /contract/accept
 */
contractRoutes.post('/accept', async (req, res) => {
  try {
    const body = ContractActionSchema.parse(req.body);
    
    const message = {
      TriggerTransition: {
        fiberId: body.contractId,
        action: 'accept',
        input: {
          acceptedBy: body.agentAddress,
          acceptedAt: new Date().toISOString(),
        },
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
    });
  } catch (err) {
    console.error('Accept error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Reject a contract proposal
 * POST /contract/reject
 */
contractRoutes.post('/reject', async (req, res) => {
  try {
    const body = ContractActionSchema.parse(req.body);
    
    const message = {
      TriggerTransition: {
        fiberId: body.contractId,
        action: 'reject',
        input: {
          rejectedBy: body.agentAddress,
          rejectedAt: new Date().toISOString(),
        },
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
    });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Complete a contract
 * POST /contract/complete
 */
contractRoutes.post('/complete', async (req, res) => {
  try {
    const body = ContractActionSchema.parse(req.body);
    
    const message = {
      TriggerTransition: {
        fiberId: body.contractId,
        action: 'complete',
        input: {
          completedBy: body.agentAddress,
          completedAt: new Date().toISOString(),
          proof: body.proof,
        },
      },
    };
    
    const result = await submitTransaction(message, body.signature);
    
    res.json({
      success: true,
      txHash: result.hash,
    });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Get contract by ID
 * GET /contract/:id
 */
contractRoutes.get('/:id', async (req, res) => {
  // TODO: Query from indexer/gateway
  res.status(501).json({ error: 'Query via Gateway GraphQL' });
});
