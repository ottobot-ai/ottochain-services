/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses Constellation's signing protocol via metakit-sdk.
 */

import { getConfig } from '@ottochain/shared';
import { signDataUpdate, generateKeyPair, keyPairFromPrivateKey } from './lib/metakit/index.js';
import type { SignatureProof, KeyPair, Signed } from './lib/metakit/types.js';

// Re-export wallet utilities
export { generateKeyPair, keyPairFromPrivateKey };
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

  // Sign the message using Constellation's DataUpdate protocol
  const proof = await signDataUpdate(message, privateKey);

  // Build the signed message envelope
  const signedMessage: Signed<unknown> = {
    value: message,
    proofs: [proof],
  };

  console.log(`[metagraph] Submitting to ${config.METAGRAPH_DL1_URL}/data`);
  console.log(`[metagraph] Message type: ${Object.keys(message as object)[0]}`);

  // Submit to DL1 data endpoint
  const response = await fetch(`${config.METAGRAPH_DL1_URL}/data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(signedMessage),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Metagraph submission failed: ${response.status} ${error}`);
  }

  const result = await response.json() as { hash?: string; ordinal?: number };

  return {
    hash: result.hash ?? 'pending',
    ordinal: result.ordinal,
  };
}

/**
 * Submit a pre-signed transaction
 * 
 * Use this when the signature was created externally (e.g., by a client wallet)
 * 
 * @param message - The message that was signed
 * @param proof - The signature proof
 */
export async function submitSignedTransaction(
  message: unknown,
  proof: SignatureProof
): Promise<TransactionResult> {
  const config = getConfig();

  const signedMessage: Signed<unknown> = {
    value: message,
    proofs: [proof],
  };

  const response = await fetch(`${config.METAGRAPH_DL1_URL}/data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(signedMessage),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Metagraph submission failed: ${response.status} ${error}`);
  }

  const result = await response.json() as { hash?: string; ordinal?: number };

  return {
    hash: result.hash ?? 'pending',
    ordinal: result.ordinal,
  };
}

/**
 * Query current state from ML0
 */
export async function queryState(endpoint: string): Promise<unknown> {
  const config = getConfig();

  const response = await fetch(`${config.METAGRAPH_ML0_URL}/data-application/v1${endpoint}`);

  if (!response.ok) {
    throw new Error(`Query failed: ${response.status}`);
  }

  return response.json();
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
