/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses @ottochain/sdk for signing and HTTP client.
 */

import { getConfig } from '@ottochain/shared';
import { batchSign, generateKeyPair as sdkGenerateKeyPair, keyPairFromPrivateKey as sdkKeyPairFromPrivateKey, HttpClient, NetworkError } from '@ottochain/sdk';
import type { KeyPair } from '@ottochain/sdk';

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

/**
 * Sign and submit a transaction to the metagraph DL1, with optional retry on 400.
 *
 * DL1 returns HTTP 400 when the submitted sequence number doesn't match the
 * validator's finalized state (race condition between calculated state at DL1
 * and snapshot-finalized state at the validator). Retrying after a short delay
 * lets the snapshot settle and usually resolves the conflict.
 *
 * @param message      - The OttochainMessage (CreateStateMachine, etc.)
 * @param privateKey   - Wallet private key in hex format
 * @param maxRetries   - Number of retry attempts on HTTP 400 (default 3)
 * @param retryDelayMs - Base delay between retries in ms (default 5000; doubles each retry)
 * @returns Transaction hash and optional ordinal
 */
export async function submitTransaction(
  message: unknown,
  privateKey: string,
  maxRetries = 3,
  retryDelayMs = 5000
): Promise<TransactionResult> {
  const config = getConfig();
  const client = new HttpClient(config.METAGRAPH_DL1_URL);

  const msgType = Object.keys(message as object)[0];
  let attempt = 0;

  while (true) {
    // Sign fresh on every attempt (nonce may differ)
    const signed = await batchSign(message, [privateKey], { isDataUpdate: true });
    const payload = { data: signed, fee: null };

    console.log(`[metagraph] Submitting to ${config.METAGRAPH_DL1_URL}/data (attempt ${attempt + 1}/${maxRetries + 1})`);
    console.log(`[metagraph] Message type: ${msgType}`);
    console.log(`[metagraph] Payload (truncated): ${JSON.stringify(payload).substring(0, 300)}...`);

    try {
      const result = await client.post<{ hash?: string; ordinal?: number }>('/data', payload);
      console.log(`[metagraph] Success: ${JSON.stringify(result)}`);
      return { hash: result.hash ?? 'pending', ordinal: result.ordinal };
    } catch (err) {
      const isNetErr = err instanceof NetworkError;
      const statusCode = isNetErr ? (err as NetworkError).statusCode : undefined;
      const responseBody = isNetErr ? (err as NetworkError).responseBody : undefined;

      if (responseBody) {
        console.error(`[metagraph] Error response (attempt ${attempt + 1}): ${responseBody}`);
      }

      // Retry on HTTP 400 (sequence mismatch / validator lag) up to maxRetries
      if (statusCode === 400 && attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt); // exponential backoff
        console.warn(`[metagraph] 400 received — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
        continue;
      }

      // Non-retriable error or retries exhausted
      const error = err as Error;
      throw new Error(`Metagraph submission failed after ${attempt + 1} attempt(s): ${error.message}`);
    }
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
 * Get the current sequence number for a fiber from DL1's onchain state.
 * 
 * This is more reliable than ML0's state for determining the next targetSequenceNumber
 * because DL1's fiberCommits is what DL1 uses for validation.
 * 
 * @param fiberId - The fiber ID to query
 * @returns The current sequence number, or 0 if not found
 */
export async function getFiberSequenceNumber(fiberId: string): Promise<number> {
  const config = getConfig();
  const dl1Url = `${config.METAGRAPH_DL1_URL}/data-application/v1/onchain`;
  const client = new HttpClient(dl1Url);
  
  try {
    const onChain = await client.get<{
      fiberCommits?: Record<string, { sequenceNumber?: number }>;
    }>('');
    
    const seq = onChain?.fiberCommits?.[fiberId]?.sequenceNumber ?? 0;
    console.log(`[metagraph] Fiber ${fiberId} sequence from DL1: ${seq}`);
    return seq;
  } catch (err) {
    console.log(`[metagraph] Could not get sequence for ${fiberId}, defaulting to 0`);
    return 0;
  }
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
