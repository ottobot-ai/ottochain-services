/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses @ottochain/sdk for signing and HTTP client.
 */

import { getConfig } from '@ottochain/shared';
import { batchSign, generateKeyPair as sdkGenerateKeyPair, keyPairFromPrivateKey as sdkKeyPairFromPrivateKey, HttpClient } from '@ottochain/sdk';
import type { KeyPair } from '@ottochain/sdk';

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

  console.log(`[metagraph] Submitting to ${config.METAGRAPH_DL1_URL}/data`);
  console.log(`[metagraph] Message type: ${Object.keys(message as object)[0]}`);
  console.log(`[metagraph] Signed payload (truncated): ${JSON.stringify(signed).substring(0, 300)}...`);

  // Use SDK's HttpClient
  const client = new HttpClient(config.METAGRAPH_DL1_URL);

  try {
    const result = await client.post<{ hash?: string; ordinal?: number }>('/data', signed);

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
 * Wait for a fiber to appear in the ML0 checkpoint state
 * 
 * This is necessary because DL1 may not have synced the fiber state yet,
 * causing "CidNotFound" errors when trying to transition immediately after creation.
 * 
 * @param fiberId - The fiber ID to wait for
 * @param maxAttempts - Maximum number of polling attempts (default 30 = 30s)
 * @param intervalMs - Polling interval in ms (default 1000 = 1s)
 * @returns true if fiber appeared, false if timeout
 */
export async function waitForFiber(
  fiberId: string,
  maxAttempts: number = 30,
  intervalMs: number = 1000
): Promise<boolean> {
  console.log(`[metagraph] Waiting for fiber ${fiberId} to appear in state (max ${maxAttempts}s)...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const checkpoint = await getCheckpoint() as { 
        ordinal: number; 
        state: { stateMachines?: Record<string, unknown> } 
      };
      
      if (checkpoint.state?.stateMachines?.[fiberId]) {
        console.log(`[metagraph] Fiber ${fiberId} found in state at ordinal ${checkpoint.ordinal} (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // Ignore errors, keep polling
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  console.log(`[metagraph] Fiber ${fiberId} not found after ${maxAttempts} attempts`);
  return false;
}
