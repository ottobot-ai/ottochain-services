// Metagraph client for transaction submission

import { getConfig } from '@ottochain/shared';

interface TransactionResult {
  hash: string;
  ordinal?: number;
}

/**
 * Submit a signed transaction to the metagraph DL1
 */
export async function submitTransaction(
  message: unknown,
  signature: string
): Promise<TransactionResult> {
  const config = getConfig();
  
  // Build the signed message envelope
  const signedMessage = {
    value: message,
    proofs: [{
      signature,
      // In production, include proper proof structure
    }],
  };
  
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
  
  const result = await response.json();
  
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
 * Wait for transaction to be included in a snapshot
 */
export async function waitForConfirmation(
  txHash: string,
  timeoutMs: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    // TODO: Implement confirmation check
    // Poll checkpoint endpoint for transaction receipt
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return false;
}
