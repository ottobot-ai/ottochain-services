/**
 * Metagraph Client
 * 
 * Submits properly signed transactions to OttoChain metagraph.
 * Uses @ottochain/sdk for signing and HTTP client.
 */

import { getConfig } from '@ottochain/shared';
import { batchSign, normalizeMessage, generateKeyPair as sdkGenerateKeyPair, keyPairFromPrivateKey as sdkKeyPairFromPrivateKey, HttpClient } from '@ottochain/sdk';
import type { KeyPair } from '@ottochain/sdk';
import { confirmationRegistry, type FiberConfirmation } from './lib/confirmation-registry.js';

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
//
// ⚠️  SINGLE-INSTANCE LIMITATION:
// This cache is in-process only. Running multiple bridge instances (e.g., behind
// a load balancer) would cause each instance to have its own cache, leading to
// sequence conflicts. For HA deployments, replace this Map with Redis:
//   - INCR ottochain:seq:<fiberId>
//   - EXPIRE with TTL for automatic cleanup
// See: https://github.com/ottobot-ai/ottochain-services/issues/109#ha-roadmap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of fibers to track in the sequence cache.
 * Prevents unbounded memory growth. When limit is reached, oldest entries
 * are evicted (FIFO via Map insertion order).
 */
const SEQUENCE_CACHE_MAX_SIZE = 10_000;

/** Maps fiberId → next expected sequence number (optimistic high-water mark). */
const sequenceCache = new Map<string, number>();

/**
 * Evict oldest entries if cache exceeds max size.
 * Uses Map's insertion-order iteration for FIFO eviction.
 */
// ── Test-only exports (prefixed with _) ───────────────────────────────────────

/** @internal Clear the sequence cache; use only in test teardown. */
export function _clearSequenceCacheForTesting(): void {
  sequenceCache.clear();
}

/** @internal Read-only view of the sequence cache for assertions. */
export function _getSequenceCacheForTesting(): ReadonlyMap<string, number> {
  return sequenceCache;
}

/** Resolve the effective sequence number: max(DL1 value, cached optimistic value). */
export function resolveSequence(fiberId: string, dl1Seq: number): number {
  const cached = sequenceCache.get(fiberId) ?? 0;
  return Math.max(dl1Seq, cached);
}

function evictOldestIfNeeded(): void {
  while (sequenceCache.size >= SEQUENCE_CACHE_MAX_SIZE) {
    const oldestKey = sequenceCache.keys().next().value;
    if (oldestKey) {
      sequenceCache.delete(oldestKey);
      console.log(`[metagraph] Sequence cache: evicted ${oldestKey} (cache full)`);
    } else {
      break;
    }
  }
}

/**
 * Advance the cached sequence for a fiber after a successful submission.
 * nextSeq = submittedSeq + 1.
 * Only advances — never goes backwards.
 */
export function advanceSequenceCache(fiberId: string, submittedSeq: number): void {
  const next = submittedSeq + 1;
  const cached = sequenceCache.get(fiberId) ?? 0;
  if (next > cached) {
    // Delete and re-insert to update insertion order (for FIFO eviction)
    sequenceCache.delete(fiberId);
    evictOldestIfNeeded();
    sequenceCache.set(fiberId, next);
    console.log(`[metagraph] Sequence cache: fiber ${fiberId} advanced to ${next} (size: ${sequenceCache.size})`);
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
  /** Which DL1 node accepted the transaction (for diagnostics) */
  acceptedBy?: string;
}

/**
 * Parse comma-separated DL1 URLs into an array.
 * Exported for testing. Application code should use getDl1Urls().
 */
export function parseDl1Urls(dl1UrlsEnv: string | undefined, fallback: string): string[] {
  if (dl1UrlsEnv) {
    const urls = dl1UrlsEnv.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return [...new Set(urls)];
  }
  return [fallback];
}

/**
 * Get the list of DL1 URLs from config.
 * Uses METAGRAPH_DL1_URLS (comma-separated) when set; falls back to METAGRAPH_DL1_URL.
 */
export function getDl1Urls(): string[] {
  const config = getConfig();
  return parseDl1Urls(config.METAGRAPH_DL1_URLS, config.METAGRAPH_DL1_URL);
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
  // Normalize before signing: ensures Option[A]=None fields are explicit null
  // (required for canonical JSON to match Metakit's circe encoder output)
  const normalizedMessage = normalizeMessage(message as Record<string, unknown>);

  // Strip fields that don't exist in Scala case classes — they'd be lost
  // during Metakit's decode→re-encode cycle, causing signature mismatch.
  // SDK 2.2.3 normalizeMessage adds 'participants' but CreateStateMachine
  // only has: fiberId, definition, initialData, parentFiberId.
  if ('CreateStateMachine' in normalizedMessage) {
    const csm = normalizedMessage.CreateStateMachine as Record<string, unknown>;
    delete csm.participants;
  }

  // Sign using SDK's batchSign (same as e2e tests)
  const signed = await batchSign(normalizedMessage, [privateKey], { isDataUpdate: true });

  // Wrap in DataTransactionRequest format expected by tessellation DL1
  const payload = { data: signed, fee: null };

  const msgType = Object.keys(normalizedMessage)[0];
  const dl1Urls = getDl1Urls();
  const seqInfo = extractSequenceInfo(normalizedMessage);

  console.log(`[metagraph] Submitting ${msgType} to ${dl1Urls.length} DL1 node(s): ${dl1Urls.join(', ')}`);
  console.log(`[metagraph] Payload (truncated): ${JSON.stringify(payload).substring(0, 300)}...`);

  /**
   * Fan out to ALL DL1 nodes in parallel.
   * Promise.any() resolves with the first success; if ALL fail it rejects
   * with an AggregateError containing all failure reasons.
   */
  const tryNode = async (url: string): Promise<TransactionResult> => {
    try {
      const client = new HttpClient(url);
      const result = await client.post<{ hash?: string; ordinal?: number }>('/data', payload);
      console.log(`[metagraph] ✓ Accepted by ${url}: ${JSON.stringify(result)}`);
      return { hash: result.hash ?? 'pending', ordinal: result.ordinal, acceptedBy: url };
    } catch (err) {
      const error = err as Error & { response?: string };
      const detail = error.response ?? error.message;
      console.warn(`[metagraph] ✗ Rejected by ${url}: ${detail}`);
      throw error;
    }
  };

  let result: TransactionResult;
  try {
    result = await Promise.any(dl1Urls.map(tryNode));
  } catch (aggErr) {
    // All nodes rejected — reset cache and surface a clear error
    if (seqInfo) resetFiberSequence(seqInfo.fiberId);

    const reasons = (aggErr instanceof AggregateError)
      ? aggErr.errors.map((e: Error) => e.message).join('; ')
      : String(aggErr);
    throw new Error(`Metagraph submission failed on all ${dl1Urls.length} DL1 node(s): ${reasons}`);
  }

  // Advance the optimistic sequence cache on success (Issue #109 fix).
  if (seqInfo) {
    advanceSequenceCache(seqInfo.fiberId, seqInfo.targetSeq);
  }

  return result;
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
  const dl1Urls = getDl1Urls();
  console.log(`[metagraph] Waiting for fiber ${fiberId} to sync to any of ${dl1Urls.length} DL1 node(s) (max ${maxAttempts}s)...`);

  /**
   * Check a single node for fiber presence.
   * Throws if not found (so Promise.any can filter).
   */
  const checkOne = async (baseUrl: string): Promise<string> => {
    const client = new HttpClient(`${baseUrl}/data-application/v1/onchain`);
    const onChain = await client.get<{
      fiberCommits?: Record<string, { sequenceNumber?: number }>;
    }>('');
    if (!onChain?.fiberCommits?.[fiberId]) {
      throw new Error(`Fiber not found on ${baseUrl}`);
    }
    return baseUrl; // Return which node found it
  };

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Promise.any returns on FIRST success — no waiting for slow nodes
      const foundOn = await Promise.any(dl1Urls.map(checkOne));
      console.log(`[metagraph] Fiber ${fiberId} found on ${foundOn} (attempt ${i + 1})`);
      return true;
    } catch {
      // All nodes returned not-found or errored — continue polling
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log(`[metagraph] Fiber ${fiberId} not synced to any DL1 after ${maxAttempts} attempts`);
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
  const dl1Urls = getDl1Urls();

  /**
   * Query all DL1 nodes in parallel and take the maximum committed sequence
   * number across all reachable nodes. This prevents us from using a stale
   * value from a minority-fork node.
   */
  const queryOne = async (baseUrl: string): Promise<{ url: string; seq: number; error?: boolean }> => {
    const url = `${baseUrl}/data-application/v1/onchain`;
    const client = new HttpClient(url);
    try {
      const onChain = await client.get<{
        fiberCommits?: Record<string, { sequenceNumber?: number }>;
      }>('');
      const seq = onChain?.fiberCommits?.[fiberId]?.sequenceNumber ?? 0;
      return { url: baseUrl, seq };
    } catch {
      return { url: baseUrl, seq: 0, error: true };
    }
  };

  const results = await Promise.all(dl1Urls.map(queryOne));
  
  // Log warnings for nodes returning seq=0 (may indicate fork or missing fiber)
  const maxSeq = Math.max(...results.map(r => r.seq));
  for (const r of results) {
    if (!r.error && r.seq === 0 && maxSeq > 0) {
      console.warn(`[metagraph] Node ${r.url} returned seq=0 for fiber ${fiberId} (max across nodes is ${maxSeq}) — may be forked`);
    }
  }

  const dl1Seq = Math.max(0, ...results.map(r => r.seq));
  const cached = sequenceCache.get(fiberId) ?? 0;
  const seq = Math.max(dl1Seq, cached);

  console.log(
    `[metagraph] Fiber ${fiberId} sequence: DL1(max across ${dl1Urls.length} nodes)=${dl1Seq}, cache=${cached}, using=${seq}`
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

/**
 * Wait for push-based confirmation from the indexer.
 *
 * This is the preferred alternative to `waitForFiber()` (polling).
 *
 * Registers the fiberId in the ConfirmationRegistry and awaits the indexer's
 * callback.  Resolves with the confirmed state as soon as the indexer calls
 * POST /internal/indexer-notify.
 *
 * Falls back gracefully: if the indexer callback is never received within
 * `timeoutMs`, the returned Promise rejects with a timeout error so the
 * caller can fall back to polling or return a 503.
 *
 * @param fiberId   - UUID of the fiber to wait for
 * @param timeoutMs - Safety timeout in milliseconds (default: 120 000 = 2 min)
 * @returns Resolved FiberConfirmation on success
 * @throws  Error on timeout (message includes fiberId and timeout duration)
 */
export async function waitForFiberConfirmation(
  fiberId: string,
  timeoutMs = 120_000
): Promise<FiberConfirmation> {
  console.log(`[metagraph] Awaiting push confirmation for fiber ${fiberId} (timeout=${timeoutMs}ms)...`);
  const confirmation = await confirmationRegistry.register(fiberId, timeoutMs);
  console.log(`[metagraph] Push confirmation received for fiber ${fiberId}: state=${confirmation.currentState}, ordinal=${confirmation.ordinal}`);
  return confirmation;
}

export type { FiberConfirmation };
