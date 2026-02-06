/**
 * ML0 Snapshot Poller
 * 
 * Polls ML0 for new snapshots and feeds them to the indexer's
 * processSnapshot pipeline. Replaces the need for ML0 to push
 * webhook notifications.
 */

import { getConfig, type SnapshotNotification } from '@ottochain/shared';
import { processSnapshot } from './processor.js';

let pollingTimer: NodeJS.Timeout | null = null;
let lastIndexedOrdinal = -1;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * Fetch the latest snapshot ordinal and hash from ML0
 */
async function fetchLatestSnapshot(): Promise<{ ordinal: number; hash: string } | null> {
  const config = getConfig();
  const url = `${config.METAGRAPH_ML0_URL}/snapshots/latest`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;

    const data = await response.json() as any;
    const ordinal = data?.value?.ordinal;
    const hash = data?.value?.lastSnapshotHash || data?.value?.hash || '';

    if (typeof ordinal !== 'number' || ordinal <= 0) return null;
    return { ordinal, hash };
  } catch {
    return null;
  }
}

/**
 * Poll for new snapshots and index them
 */
async function pollOnce(): Promise<void> {
  const latest = await fetchLatestSnapshot();

  if (!latest) {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.warn(`⚠️ ML0 snapshot poller: ${consecutiveErrors} consecutive failures`);
    }
    return;
  }

  consecutiveErrors = 0;

  // Skip if we already indexed this ordinal
  if (latest.ordinal <= lastIndexedOrdinal) return;

  // If this is the first poll, just set the baseline (don't backfill everything)
  if (lastIndexedOrdinal === -1) {
    // Index the current snapshot to get initial state
    console.log(`🔄 Snapshot poller: starting from ordinal ${latest.ordinal}`);
  }

  const notification: SnapshotNotification = {
    ordinal: latest.ordinal,
    hash: latest.hash,
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await processSnapshot(notification);
    lastIndexedOrdinal = latest.ordinal;
    
    // Only log if there were actual changes
    if (result.fibersUpdated > 0 || result.agentsUpdated > 0 || result.contractsUpdated > 0) {
      console.log(`🔄 Polled snapshot ${latest.ordinal}: ${result.fibersUpdated}F ${result.agentsUpdated}A ${result.contractsUpdated}C`);
    }
  } catch (err) {
    console.error(`❌ Failed to process polled snapshot ${latest.ordinal}:`, err);
    consecutiveErrors++;
  }
}

/**
 * Start the ML0 snapshot poller
 */
export function startSnapshotPoller(intervalMs = 5000): void {
  if (pollingTimer) {
    console.warn('⚠️ Snapshot poller already running');
    return;
  }

  console.log(`🔄 Starting ML0 snapshot poller (every ${intervalMs}ms)`);
  
  // Initial poll immediately
  pollOnce();
  
  // Then poll on interval
  pollingTimer = setInterval(pollOnce, intervalMs);
}

/**
 * Stop the ML0 snapshot poller
 */
export function stopSnapshotPoller(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('🛑 Stopped ML0 snapshot poller');
  }
}

/**
 * Get poller stats
 */
export function getPollerStats() {
  return {
    lastIndexedOrdinal,
    consecutiveErrors,
    isRunning: pollingTimer !== null,
  };
}
