/**
 * Snapshot decoder for ottochain on-chain state
 *
 * Fetches currency incremental snapshots from metagraph L0 and decodes the
 * on-chain state from the DataApplicationPart's binary payload.
 *
 * The on-chain state is serialized using JsonBinaryCodec (canonical JSON → UTF-8 bytes).
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/OnChain.scala
 * @packageDocumentation
 */

import { HttpClient } from '../metakit/network/client.js';
import type { OnChain, EventReceipt, OracleInvocation, FiberLogEntry } from './types.js';

/**
 * Decode on-chain state from binary (JsonBinaryCodec format).
 *
 * JsonBinaryCodec serialization is: canonical JSON → UTF-8 bytes.
 * So decoding is simply: UTF-8 bytes → JSON.parse.
 *
 * @param bytes - UTF-8 encoded canonical JSON bytes
 * @returns Decoded OnChain state
 */
export function decodeOnChainState(bytes: Uint8Array): OnChain {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as OnChain;
}

/**
 * Snapshot response shape from GET /snapshots/{ordinal} or /snapshots/latest
 * on the metagraph L0 node (port 9200 by default).
 */
export interface CurrencySnapshotResponse {
  value: {
    ordinal: number;
    dataApplication?: {
      onChainState: number[];
      blocks: unknown[];
    };
    [key: string]: unknown;
  };
  proofs: unknown[];
}

/**
 * Fetch and decode the on-chain state from a specific snapshot ordinal.
 *
 * @param ml0BaseUrl - Metagraph L0 node base URL (e.g., 'http://localhost:9200')
 * @param ordinal - Snapshot ordinal number
 * @returns Decoded OnChain state, or null if no data application part
 */
export async function getSnapshotOnChainState(
  ml0BaseUrl: string,
  ordinal: number
): Promise<OnChain | null> {
  const client = new HttpClient(ml0BaseUrl);
  const snapshot = await client.get<CurrencySnapshotResponse>(`/snapshots/${ordinal}`);
  return extractOnChainState(snapshot);
}

/**
 * Fetch and decode the on-chain state from the latest snapshot.
 *
 * @param ml0BaseUrl - Metagraph L0 node base URL (e.g., 'http://localhost:9200')
 * @returns Decoded OnChain state, or null if no data application part
 */
export async function getLatestOnChainState(
  ml0BaseUrl: string
): Promise<OnChain | null> {
  const client = new HttpClient(ml0BaseUrl);
  const snapshot = await client.get<CurrencySnapshotResponse>('/snapshots/latest');
  return extractOnChainState(snapshot);
}

/**
 * Extract and decode on-chain state from a snapshot response.
 */
export function extractOnChainState(snapshot: CurrencySnapshotResponse): OnChain | null {
  const dataPart = snapshot.value?.dataApplication;
  if (!dataPart?.onChainState) {
    return null;
  }

  const bytes = new Uint8Array(dataPart.onChainState);
  return decodeOnChainState(bytes);
}

// ---------------------------------------------------------------------------
// Log filtering helpers
// ---------------------------------------------------------------------------

/**
 * Get all log entries for a specific fiber from on-chain state.
 *
 * @param onChain - Decoded on-chain state
 * @param fiberId - Fiber UUID to filter by
 * @returns Array of log entries for the fiber, or empty array
 */
export function getLogsForFiber(onChain: OnChain, fiberId: string): FiberLogEntry[] {
  return onChain.latestLogs[fiberId] ?? [];
}

/**
 * Get EventReceipt log entries for a specific fiber.
 *
 * EventReceipts are distinguished from OracleInvocations by the presence
 * of the `eventName` field.
 *
 * @param onChain - Decoded on-chain state
 * @param fiberId - Fiber UUID to filter by
 * @returns Array of EventReceipt entries
 */
export function getEventReceipts(onChain: OnChain, fiberId: string): EventReceipt[] {
  return getLogsForFiber(onChain, fiberId)
    .filter((entry): entry is EventReceipt => 'eventName' in entry && 'success' in entry);
}

/**
 * Get OracleInvocation log entries for a specific fiber.
 *
 * OracleInvocations are distinguished from EventReceipts by the presence
 * of the `method` field.
 *
 * @param onChain - Decoded on-chain state
 * @param fiberId - Fiber UUID to filter by
 * @returns Array of OracleInvocation entries
 */
export function getOracleInvocations(onChain: OnChain, fiberId: string): OracleInvocation[] {
  return getLogsForFiber(onChain, fiberId)
    .filter((entry): entry is OracleInvocation => 'method' in entry && 'result' in entry);
}
