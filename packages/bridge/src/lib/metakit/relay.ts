/**
 * Relay a pre-signed transaction to the metagraph DL1 nodes.
 * Used for self-signed mode where the client has already signed the transaction.
 */

import { HttpClient } from '@ottochain/sdk';
import { getConfig } from '@ottochain/shared';

export async function relaySignedTransaction(signedUpdate: { value: unknown; proofs: unknown[] }): Promise<{ hash: string }> {
  const config = getConfig();
  const payload = { data: signedUpdate, fee: null };

  // Parse DL1 URLs from config
  const dl1Urls = config.METAGRAPH_DL1_URLS
    ? config.METAGRAPH_DL1_URLS.split(',').map((u: string) => u.trim()).filter(Boolean)
    : [config.METAGRAPH_DL1_URL];

  const tryNode = async (url: string): Promise<{ hash: string }> => {
    const client = new HttpClient(url);
    const result = await client.post<{ hash?: string }>('/data', payload);
    return { hash: result.hash ?? 'pending' };
  };

  try {
    return await Promise.any(dl1Urls.map(tryNode));
  } catch (aggErr) {
    const reasons = (aggErr instanceof AggregateError)
      ? aggErr.errors.map((e: Error) => e.message).join('; ')
      : String(aggErr);
    throw new Error(`Metagraph relay failed: ${reasons}`);
  }
}
