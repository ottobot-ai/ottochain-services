/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses @ottochain/sdk for signing and HTTP client.
 */

import { getConfig } from '@ottochain/shared';
import { batchSign, generateKeyPair as sdkGenerateKeyPair, keyPairFromPrivateKey as sdkKeyPairFromPrivateKey, HttpClient } from '@ottochain/sdk';
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
 * Sign and submit a transaction to the metagraph DL1
 * 
 * @param message - The OttochainMessage (CreateStateMachine, TransitionStateMachine, etc.)
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
  // Format: { data: Signed<DataUpdate>, fee: Option<Signed<FeeTransaction>> }
  const payload = {
    data: signed,
    fee: null,
  };

  console.log(`[metagraph] Submitting to ${config.METAGRAPH_DL1_URL}/data`);
  console.log(`[metagraph] Message type: ${Object.keys(message as object)[0]}`);
  console.log(`[metagraph] Payload (truncated): ${JSON.stringify(payload).substring(0, 300)}...`);

  // Use SDK's HttpClient
  const client = new HttpClient(config.METAGRAPH_DL1_URL);

  try {
    const result = await client.post<{ hash?: string; ordinal?: number }>('/data', payload);

    console.log(`[metagraph] Success: ${JSON.stringify(result)}`);

    return {
      hash: result.hash ?? 'pending',
      ordinal: result.ordinal,
    };
  } catch (err) {
    const error = err as Error & { response?: string };
    if (error.response) {
      console.error(`[metagraph] Error response: ${error.response}`);
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
 * Wait for a fiber to reach a specific sequence number in DL1's onchain state
 * 
 * This is essential for multi-step workflows where each transition must wait
 * for DL1's cache to sync before the next transition can be submitted.
 * 
 * The timing issue: ML0 processes transactions immediately, but DL1's validation
 * cache uses snapshot state which lags by ~10s. Without waiting, the next
 * transition fails with "Sequence number mismatch".
 * 
 * Based on ottochain e2e tests pattern (waitForDl1Sync).
 * 
 * @param fiberId - The fiber ID to wait for
 * @param expectedSeq - Expected sequence number (or null for existence check only)
 * @param maxAttempts - Maximum polling attempts (default 60)
 * @param intervalMs - Polling interval in ms (default 1000)
 * @returns The current sequence number when synced
 * @throws Error if timeout or fiber not found
 */
export async function waitForFiberSequence(
  fiberId: string,
  expectedSeq: number | null,
  maxAttempts: number = 60,
  intervalMs: number = 1000
): Promise<number> {
  const config = getConfig();
  const dl1Url = `${config.METAGRAPH_DL1_URL}/data-application/v1/onchain`;
  const client = new HttpClient(dl1Url);
  
  const seqLabel = expectedSeq === null ? 'exists' : `seq≥${expectedSeq}`;
  console.log(`[metagraph] Waiting for fiber ${fiberId.slice(0, 8)}... to reach ${seqLabel} in DL1...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const onChain = await client.get<{
        fiberCommits?: Record<string, { sequenceNumber?: number }>;
      }>('');
      
      const commit = onChain?.fiberCommits?.[fiberId];
      if (commit) {
        const currentSeq = commit.sequenceNumber ?? 0;
        
        if (expectedSeq === null) {
          console.log(`[metagraph] Fiber ${fiberId.slice(0, 8)}... exists in DL1 (seq=${currentSeq})`);
          return currentSeq;
        }
        
        if (currentSeq >= expectedSeq) {
          console.log(`[metagraph] Fiber ${fiberId.slice(0, 8)}... synced to DL1 (seq=${currentSeq})`);
          return currentSeq;
        }
        
        console.log(`[metagraph] Fiber ${fiberId.slice(0, 8)}... seq=${currentSeq}, waiting for ${expectedSeq}...`);
      }
    } catch {
      // DL1 may not be ready yet — continue polling
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  throw new Error(
    `DL1 sync timeout: fiber ${fiberId} did not reach seq=${expectedSeq} after ${maxAttempts} attempts`
  );
}

/**
 * Get the current sequence number of a fiber from DL1's onchain cache
 * 
 * @param fiberId - The fiber ID to check
 * @returns The sequence number, or null if fiber not found
 */
export async function getDl1SequenceNumber(fiberId: string): Promise<number | null> {
  const config = getConfig();
  const dl1Url = `${config.METAGRAPH_DL1_URL}/data-application/v1/onchain`;
  const client = new HttpClient(dl1Url);
  
  try {
    const onChain = await client.get<{
      fiberCommits?: Record<string, { sequenceNumber?: number }>;
    }>('');
    
    const commit = onChain?.fiberCommits?.[fiberId];
    return commit?.sequenceNumber ?? null;
  } catch {
    return null;
  }
}
