/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses @ottochain/sdk for signing and HTTP client.
 */

import { getConfig } from '@ottochain/shared';
import { batchSign, generateKeyPair as sdkGenerateKeyPair, keyPairFromPrivateKey as sdkKeyPairFromPrivateKey, HttpClient } from '@ottochain/sdk';
import type { KeyPair } from '@ottochain/sdk';

// ─── Optimistic Sequence Cache ────────────────────────────────────────────────
//
// Problem (Issue #109): When multiple transactions are submitted rapidly for
// the same fiber (e.g., commit-A → commit-B → close), all calls to
// getFiberSequenceNumber() return the same stale value from DL1 because DL1
// hasn't applied the previous transaction yet.
//
// Fix: After each successful submission we *optimistically* advance a local
// per-fiber counter. getFiberSequenceNumber() returns max(DL1_value, cached)
// so the next caller always sees an incremented value without waiting for DL1.
//
// The cache is process-scoped (server restart resets it to DL1 state).
// On submission error the caller may call resetFiberSequence() to force a
// fresh read from DL1 on the next attempt.
// ─────────────────────────────────────────────────────────────────────────────

/** Maps fiberId → next expected sequence number (optimistic high-water mark). */
const sequenceCache = new Map<string, number>();

/**
 * Advance the cached sequence for a fiber after a successful submission.
 * nextSeq = submittedSeq + 1.
 * Only advances — never goes backwards.
 */
function advanceSequenceCache(fiberId: string, submittedSeq: number): void {
  const next = submittedSeq + 1;
  const cached = sequenceCache.get(fiberId) ?? 0;
  if (next > cached) {
    sequenceCache.set(fiberId, next);
    console.log(`[metagraph] Sequence cache: fiber ${fiberId} advanced to ${next}`);
  }
}

/**
 * Reset the cached sequence for a fiber (e.g. after a submission error).
 * The next call to getFiberSequenceNumber will re-read from DL1.
 */
export function resetFiberSequence(fiberId: string): void {
  sequenceCache.delete(fiberId);
  console.log(`[metagraph] Sequence cache: fiber ${fiberId} reset`);
}

// Re-export SDK core types for use by route handlers
export type {
  StateMachineDefinition,
  CreateStateMachine,
  TransitionStateMachine,
  ArchiveStateMachine,
  CreateScript,
  InvokeScript,
  OttochainMessage,
  FiberStatus,
  EventReceipt,
  Address,
  FiberOrdinal,
  SnapshotOrdinal,
  StateId,
  StateMachineFiberRecord,
  ScriptFiberRecord,
} from '@ottochain/sdk/core';

// Re-export wallet utilities from SDK
export function generateKeyPair(): KeyPair {
  return sdkGenerateKeyPair();
}

export function keyPairFromPrivateKey(privateKey: string): KeyPair {
  return sdkKeyPairFromPrivateKey(privateKey);
}

export type { KeyPair };

interface TransactionResult {
  hash: string;
  ordinal?: number;
}

// Internal: extract fiberId and targetSequenceNumber from any OttoChain message.
// Messages that contain a targetSequenceNumber are Transition/Archive/InvokeScript.
// Returns null for CreateStateMachine/CreateScript (no sequence to track).
function extractSequenceInfo(
  message: unknown
): { fiberId: string; targetSeq: number } | null {
  const msg = message as Record<string, Record<string, unknown>>;

  for (const key of ['TransitionStateMachine', 'ArchiveStateMachine', 'InvokeScript']) {
    const inner = msg[key];
    if (inner) {
      const fiberId = inner.fiberId as string | undefined;
      const targetSeq = inner.targetSequenceNumber as number | undefined;
      if (fiberId && typeof targetSeq === 'number') {
        return { fiberId, targetSeq };
      }
    }
  }
  return null;
}

/**
 * Sign and submit a transaction to the metagraph DL1.
 *
 * Automatically advances the in-process sequence cache on success so that
 * rapid back-to-back submissions for the same fiber get monotonically
 * increasing targetSequenceNumbers (fix for Issue #109).
 *
 * @param message    - The OttochainMessage (CreateStateMachine, TransitionStateMachine, etc.)
 * @param privateKey - Wallet private key in hex format
 * @returns Transaction hash and optional ordinal
 */
export async function submitTransaction(
  message: unknown,
  privateKey: string
): Promise<TransactionResult> {
  const config = getConfig();

  // Sign using SDK's batchSign (same as e2e tests)
  const signed = await batchSign(message, [privateKey], { isDataUpdate: true });

  // Wrap in DataTransactionRequest format expected by tessellation DL1
  const payload = { data: signed, fee: null };

  const msgType = Object.keys(message as object)[0];
  console.log(`[metagraph] Submitting to ${config.METAGRAPH_DL1_URL}/data`);
  console.log(`[metagraph] Message type: ${msgType}`);
  console.log(`[metagraph] Payload (truncated): ${JSON.stringify(payload).substring(0, 300)}...`);

  const client = new HttpClient(config.METAGRAPH_DL1_URL);
  const seqInfo = extractSequenceInfo(message);

  try {
    const result = await client.post<{ hash?: string; ordinal?: number }>('/data', payload);
    console.log(`[metagraph] Success: ${JSON.stringify(result)}`);

    // Advance the optimistic sequence cache so the next submission for this
    // fiber immediately sees the incremented value (Issue #109 fix).
    if (seqInfo) {
      advanceSequenceCache(seqInfo.fiberId, seqInfo.targetSeq);
    }

    return { hash: result.hash ?? 'pending', ordinal: result.ordinal };
  } catch (err) {
    const error = err as Error & { response?: string };
    if (error.response) {
      console.error(`[metagraph] Error response: ${error.response}`);
    }
    // On error, reset the cache so the next attempt reads fresh from DL1.
    if (seqInfo) {
      resetFiberSequence(seqInfo.fiberId);
    }
    throw new Error(`Metagraph submission failed: ${error.message}`);
  }
}

/**
 * Query current state from ML0
 */
export async function queryState(endpoint: string): Promise<unknown> {
  const config = getConfig();

  const client = new HttpClient(config.METAGRAPH_ML0_URL);
  return client.get(`/data-application/v1${endpoint}`);
}

/**
 * Get current checkpoint (latest snapshot ordinal and state)
 */
export async function getCheckpoint(): Promise<{ ordinal: number; state: unknown }> {
  return queryState('/checkpoint') as Promise<{ ordinal: number; state: unknown }>;
}

/**
 * Get a specific state machine by fiber ID
 */
export async function getStateMachine(fiberId: string): Promise<unknown> {
  return queryState(`/state-machines/${fiberId}`);
}

/**
 * Get a specific script fiber by ID
 */
export async function getScriptFiber(scriptId: string): Promise<unknown> {
  return queryState(`/scripts/${scriptId}`);
}

/**
 * Get all scripts
 */
export async function getScripts(): Promise<Record<string, unknown>> {
  return queryState('/scripts') as Promise<Record<string, unknown>>;
}

/**
 * Get all state machines, optionally filtered by status
 */
export async function getStateMachines(status?: string): Promise<Record<string, unknown>> {
  const query = status ? `?status=${status}` : '';
  return queryState(`/state-machines${query}`) as Promise<Record<string, unknown>>;
}

/**
 * Wait for a transaction to be included in a snapshot
 * 
 * @param minOrdinal - Minimum ordinal to wait for
 * @param timeoutMs - Timeout in milliseconds (default 60s)
 */
export async function waitForSnapshot(
  minOrdinal: number,
  timeoutMs: number = 60000
): Promise<number> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const checkpoint = await getCheckpoint();
    if (checkpoint.ordinal > minOrdinal) {
      return checkpoint.ordinal;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Snapshot timeout after ${timeoutMs}ms`);
}

/**
 * Wait for a fiber to sync to DL1's onchain state
 * 
 * This polls DL1's /data-application/v1/onchain endpoint to check if the fiber
 * has been committed. This is the correct way to ensure DL1 has synced the state
 * from ML0 → GL0 → DL1 before attempting transitions.
 * 
 * Based on the pattern from ottochain e2e tests (waitForDl1Sync).
 * 
 * @param fiberId - The fiber ID to wait for
 * @param maxAttempts - Maximum number of polling attempts (default 60 = 60s)
 * @param intervalMs - Polling interval in ms (default 1000 = 1s)
 * @returns true if fiber synced to DL1, false if timeout
 */
export async function waitForFiber(
  fiberId: string,
  maxAttempts: number = 60,
  intervalMs: number = 1000
): Promise<boolean> {
  const config = getConfig();
  const dl1Url = `${config.METAGRAPH_DL1_URL}/data-application/v1/onchain`;
  const client = new HttpClient(dl1Url);
  
  console.log(`[metagraph] Waiting for fiber ${fiberId} to sync to DL1 (max ${maxAttempts}s)...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const onChain = await client.get<{
        fiberCommits?: Record<string, { sequenceNumber?: number }>;
      }>('');
      
      if (onChain?.fiberCommits?.[fiberId]) {
        console.log(`[metagraph] Fiber ${fiberId} found in DL1 onchain state (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // DL1 may not be ready yet — continue polling
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  console.log(`[metagraph] Fiber ${fiberId} not synced to DL1 after ${maxAttempts} attempts`);
  return false;
}

/**
 * Get the current sequence number for a fiber.
 *
 * Returns max(DL1_value, optimistic_cache) to ensure rapid back-to-back
 * submissions always get monotonically increasing sequence numbers even
 * before DL1 has applied the previous transaction.
 *
 * See: GitHub Issue #109 — Bridge sends same targetSequenceNumber for
 * rapid successive transactions.
 *
 * @param fiberId - The fiber ID to query
 * @returns The sequence number to use as targetSequenceNumber for the NEXT submission
 */
export async function getFiberSequenceNumber(fiberId: string): Promise<number> {
  const config = getConfig();
  const dl1Url = `${config.METAGRAPH_DL1_URL}/data-application/v1/onchain`;
  const client = new HttpClient(dl1Url);

  let dl1Seq = 0;
  try {
    const onChain = await client.get<{
      fiberCommits?: Record<string, { sequenceNumber?: number }>;
    }>('');
    dl1Seq = onChain?.fiberCommits?.[fiberId]?.sequenceNumber ?? 0;
  } catch {
    // DL1 unreachable — fall back to cache only
  }

  const cached = sequenceCache.get(fiberId) ?? 0;
  const seq = Math.max(dl1Seq, cached);

  console.log(
    `[metagraph] Fiber ${fiberId} sequence: DL1=${dl1Seq}, cache=${cached}, using=${seq}`
  );
  return seq;
}

/**
 * Get the current epoch progress from ML0.
 * 
 * EpochProgress is a steady time measure that doesn't burst with high traffic
 * like ordinals. Use this for deadline calculations and time-based guards.
 * 
 * @returns The current epoch progress value
 */
export async function getEpochProgress(): Promise<number> {
  const config = getConfig();
  const client = new HttpClient(config.METAGRAPH_ML0_URL);
  
  try {
    const nodeInfo = await client.get<{
      epochProgress?: number;
    }>('/node/info');
    
    const epoch = nodeInfo?.epochProgress ?? 0;
    console.log(`[metagraph] Current epoch progress: ${epoch}`);
    return epoch;
  } catch (err) {
    console.warn(`[metagraph] Could not get epoch progress, defaulting to 0`);
    return 0;
  }
}

/**
 * Wait for a fiber's sequence number to reach a target value.
 * 
 * Use this after submitting a transaction to ensure it's been processed
 * before submitting the next one.
 * 
 * @param fiberId - The fiber ID to watch
 * @param targetSeq - The sequence number to wait for
 * @param maxAttempts - Maximum polling attempts (default 30 = 30s)
 * @param intervalMs - Polling interval (default 1000 = 1s)
 * @returns true if target reached, false if timeout
 */
export async function waitForSequence(
  fiberId: string,
  targetSeq: number,
  maxAttempts: number = 30,
  intervalMs: number = 1000
): Promise<boolean> {
  console.log(`[metagraph] Waiting for fiber ${fiberId} to reach sequence ${targetSeq}...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    const currentSeq = await getFiberSequenceNumber(fiberId);
    if (currentSeq >= targetSeq) {
      console.log(`[metagraph] Fiber ${fiberId} reached sequence ${currentSeq} (target: ${targetSeq})`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  console.log(`[metagraph] Timeout waiting for fiber ${fiberId} to reach sequence ${targetSeq}`);
  return false;
}
