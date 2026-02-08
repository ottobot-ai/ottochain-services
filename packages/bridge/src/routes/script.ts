// Generic Script Oracle Routes
// Thin wrapper around OttoChain CreateScript / InvokeScript
// Symmetric to SM routes: register, invoke, query

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getScriptFiber, 
  getCheckpoint, 
  keyPairFromPrivateKey,
  type CreateScript,
  type InvokeScript,
  type FiberOrdinal,
} from '../metagraph.js';

export const scriptRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const RegisterScriptSchema = z.object({
  privateKey: z.string().length(64),
  
  // Script definition
  name: z.string().optional(),
  description: z.string().optional(),
  program: z.record(z.unknown()), // JSON Logic expression
  
  // Optional initial state (for stateful scripts)
  initialState: z.record(z.unknown()).optional(),
  
  // Access control
  accessControl: z.object({
    invokers: z.array(z.string()).optional(), // Who can invoke (empty = anyone)
    owners: z.array(z.string()).optional(),   // Who can update
  }).optional(),
  
  // Metadata
  metadata: z.record(z.unknown()).optional(),
  
  fiberId: z.string().uuid().optional(), // Allow caller to specify ID
});

const InvokeScriptSchema = z.object({
  privateKey: z.string().length(64),
  scriptId: z.string().uuid(),
  inputs: z.record(z.unknown()), // Input data for the script
  context: z.record(z.unknown()).optional(), // Optional additional context
});

const BatchInvokeSchema = z.object({
  privateKey: z.string().length(64),
  invocations: z.array(z.object({
    scriptId: z.string().uuid(),
    inputs: z.record(z.unknown()),
    context: z.record(z.unknown()).optional(),
  })),
});

const UpdateScriptSchema = z.object({
  privateKey: z.string().length(64),
  program: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
  accessControl: z.object({
    invokers: z.array(z.string()).optional(),
    owners: z.array(z.string()).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const QueryScriptsSchema = z.object({
  name: z.string().optional(),
  owner: z.string().optional(),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register a new script oracle
 * POST /script/register
 */
scriptRoutes.post('/register', async (req, res) => {
  try {
    const input = RegisterScriptSchema.parse(req.body);
    
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;
    const fiberId = input.fiberId ?? randomUUID();

    const message = {
      CreateScript: {
        fiberId,
        scriptProgram: input.program,
        stateData: input.initialState ?? null,
        accessControl: input.accessControl ?? {
          invokers: [], // Anyone can invoke by default
          owners: [creatorAddress],
        },
        metadata: {
          name: input.name,
          description: input.description,
          createdAt: new Date().toISOString(),
          ...input.metadata,
        },
      },
    };

    console.log(`[script/register] Creating script ${input.name ?? 'unnamed'} (${fiberId})`);
    console.log(`  Owner: ${creatorAddress}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      scriptId: fiberId,
      owner: creatorAddress,
      name: input.name,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[script/register] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Registration failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Invoke a script with inputs
 * POST /script/invoke
 */
scriptRoutes.post('/invoke', async (req, res) => {
  try {
    const input = InvokeScriptSchema.parse(req.body);
    
    const script = await getScriptFiber(input.scriptId) as {
      sequenceNumber?: number;
      metadata?: { name?: string };
    } | null;

    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;
    const invocationId = randomUUID();

    const message = {
      InvokeScript: {
        invocationId,
        scriptId: input.scriptId,
        inputs: input.inputs,
        context: {
          timestamp: Date.now(),
          caller: callerAddress,
          ...input.context,
        },
        targetSequenceNumber: script.sequenceNumber ?? 0,
      },
    };

    const scriptName = script.metadata?.name ?? 'Script';
    console.log(`[script/invoke] ${scriptName} (${input.scriptId})`);
    console.log(`  Caller: ${callerAddress}`);
    console.log(`  Inputs: ${JSON.stringify(input.inputs).slice(0, 100)}...`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      invocationId,
      scriptId: input.scriptId,
      caller: callerAddress,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[script/invoke] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Invocation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Batch invoke multiple scripts
 * POST /script/invoke/batch
 */
scriptRoutes.post('/invoke/batch', async (req, res) => {
  try {
    const input = BatchInvokeSchema.parse(req.body);
    
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;
    const batchId = randomUUID();

    // Build invocations with IDs
    const invocations = input.invocations.map((inv, index) => ({
      invocationId: randomUUID(),
      scriptId: inv.scriptId,
      inputs: inv.inputs,
      context: {
        timestamp: Date.now(),
        caller: callerAddress,
        batchId,
        batchIndex: index,
        ...inv.context,
      },
    }));

    const message = {
      BatchInvokeScripts: {
        batchId,
        invocations,
      },
    };

    console.log(`[script/invoke/batch] Batch ${batchId}: ${invocations.length} invocations`);
    console.log(`  Caller: ${callerAddress}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      batchId,
      count: invocations.length,
      invocations: invocations.map((inv) => ({
        invocationId: inv.invocationId,
        scriptId: inv.scriptId,
      })),
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[script/invoke/batch] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Batch invocation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get script by ID
 * GET /script/:scriptId
 */
scriptRoutes.get('/:scriptId', async (req, res) => {
  try {
    const script = await getScriptFiber(req.params.scriptId);
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json(script);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get last invocation result
 * GET /script/:scriptId/result
 */
scriptRoutes.get('/:scriptId/result', async (req, res) => {
  try {
    const script = await getScriptFiber(req.params.scriptId) as {
      lastInvocation?: unknown;
      stateData?: unknown;
      metadata?: { name?: string };
    } | null;

    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    res.json({
      scriptId: req.params.scriptId,
      name: script.metadata?.name,
      lastInvocation: script.lastInvocation ?? null,
      state: script.stateData ?? null,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * List scripts with optional filters
 * GET /script?name=X&owner=Y
 */
scriptRoutes.get('/', async (req, res) => {
  try {
    const query = QueryScriptsSchema.parse({
      name: req.query.name,
      owner: req.query.owner,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });

    const checkpoint = await getCheckpoint() as {
      ordinal: number;
      state: {
        scripts?: Record<string, {
          metadata?: { name?: string };
          accessControl?: { owners?: string[] };
        }>;
      };
    };

    let results = Object.entries(checkpoint.state.scripts ?? {});

    // Apply filters
    if (query.name) {
      results = results.filter(([_, s]) => 
        s.metadata?.name?.toLowerCase().includes(query.name!.toLowerCase())
      );
    }
    if (query.owner) {
      results = results.filter(([_, s]) => 
        s.accessControl?.owners?.includes(query.owner!)
      );
    }

    const total = results.length;

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    results = results.slice(offset, offset + limit);

    res.json({
      total,
      offset,
      limit,
      count: results.length,
      scripts: Object.fromEntries(results),
    });
  } catch (err) {
    console.error('[script/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Update a script (owner only)
 * POST /script/:scriptId/update
 */
scriptRoutes.post('/:scriptId/update', async (req, res) => {
  try {
    const input = UpdateScriptSchema.parse(req.body);
    const scriptId = req.params.scriptId;

    const script = await getScriptFiber(scriptId) as {
      sequenceNumber?: number;
      accessControl?: { owners?: string[] };
    } | null;

    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Check ownership
    const owners = script.accessControl?.owners ?? [];
    if (owners.length > 0 && !owners.includes(callerAddress)) {
      return res.status(403).json({ error: 'Not authorized to update this script' });
    }

    const updates: Record<string, unknown> = {};
    if (input.program) updates.scriptProgram = input.program;
    if (input.state) updates.stateData = input.state;
    if (input.accessControl) updates.accessControl = input.accessControl;
    if (input.metadata) updates.metadata = input.metadata;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const message = {
      UpdateScript: {
        scriptId,
        updates,
        targetSequenceNumber: script.sequenceNumber ?? 0,
      },
    };

    console.log(`[script/update] ${scriptId}`);
    console.log(`  Updater: ${callerAddress}`);
    console.log(`  Fields: ${Object.keys(updates).join(', ')}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      scriptId,
      updatedFields: Object.keys(updates),
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[script/update] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Update failed';
    res.status(500).json({ error: errorMessage });
  }
});
