/**
 * GL0 Confirmation Poller
 * 
 * Polls GL0 global snapshots to confirm ML0 currency snapshots.
 * Updates status from PENDING → CONFIRMED when hash appears in GL0.
 */

import { prisma, getConfig, publishEvent, CHANNELS } from '@ottochain/shared';

interface GlobalSnapshot {
  value: {
    ordinal: number;
    // stateChannelSnapshots: metagraphId → array of currency snapshot binaries
    // Each entry has { value: { lastSnapshotHash, content } }
    stateChannelSnapshots: Record<string, Array<{
      value: {
        lastSnapshotHash: string;
        content: number[];
      };
    }>>;
  };
}

let pollingInterval: NodeJS.Timeout | null = null;
let lastCheckedGl0Ordinal = 0;

/**
 * Check GL0 for confirmed metagraph snapshots
 */
async function checkConfirmations(): Promise<void> {
  const config = getConfig();
  const gl0Url = config.GL0_URL!;  // Guaranteed by startup validation
  const metagraphId = config.METAGRAPH_ID!;  // Guaranteed by startup validation
  
  try {
    // Fetch latest global snapshot
    const response = await fetch(`${gl0Url}/global-snapshots/latest`);
    if (!response.ok) {
      console.warn(`⚠️ GL0 returned ${response.status}`);
      return;
    }
    
    const globalSnapshot = await response.json() as GlobalSnapshot;
    const gl0Ordinal = globalSnapshot.value.ordinal;
    
    // Skip if we've already checked this ordinal
    if (gl0Ordinal <= lastCheckedGl0Ordinal) {
      return;
    }
    lastCheckedGl0Ordinal = gl0Ordinal;
    
    // Check if our metagraph appears in this GL0 snapshot
    const stateChannels = globalSnapshot.value.stateChannelSnapshots ?? {};
    
    // Look for our metagraph's currency snapshots in GL0
    // The metagraph ID key in stateChannelSnapshots confirms GL0 received our snapshot
    const metagraphSnapshots = stateChannels[metagraphId];
    
    if (!metagraphSnapshots || metagraphSnapshots.length === 0) {
      // Our metagraph didn't produce a snapshot in this GL0 ordinal — normal, skip
      return;
    }
    
    // Our metagraph IS in this GL0 snapshot — batch-confirm all pending up to this point.
    // GL0 including our metagraph means it accepted the latest ML0 binary, which implies
    // all prior ML0 snapshots were valid (chain is linear).
    const latestEntry = metagraphSnapshots[metagraphSnapshots.length - 1];
    const confirmedHash = latestEntry.value.lastSnapshotHash;
    const gl0OrdinalBigInt = BigInt(gl0Ordinal);
    
    // Try to find the specific snapshot by hash to get its ordinal as the upper bound
    const matchedByHash = await prisma.indexedSnapshot.findFirst({
      where: { hash: confirmedHash, status: 'PENDING' }
    });
    
    // If hash matches, confirm everything up to that ordinal.
    // If no match (hash mismatch from polling vs webhook), confirm ALL pending —
    // GL0 accepted our latest state, so all prior are implicitly confirmed.
    const upperBound = matchedByHash?.ordinal;
    
    const batchResult = await prisma.indexedSnapshot.updateMany({
      where: {
        status: 'PENDING',
        ...(upperBound ? { ordinal: { lte: upperBound } } : {}),
      },
      data: {
        status: 'CONFIRMED',
        gl0Ordinal: gl0OrdinalBigInt,
        confirmedAt: new Date(),
      }
    });
    
    if (batchResult.count > 0) {
      console.log(`✅ Batch-confirmed ${batchResult.count} ML0 snapshots in GL0 ordinal ${gl0Ordinal} (hash: ${confirmedHash.slice(0, 12)}...)`);
      
      // Backfill gl0Ordinal on fibers and transitions for all confirmed snapshots
      await prisma.fiber.updateMany({
        where: { createdGl0Ordinal: null },
        data: { createdGl0Ordinal: gl0OrdinalBigInt }
      });
      await prisma.fiber.updateMany({
        where: { updatedGl0Ordinal: null },
        data: { updatedGl0Ordinal: gl0OrdinalBigInt }
      });
      await prisma.fiberTransition.updateMany({
        where: { gl0Ordinal: null },
        data: { gl0Ordinal: gl0OrdinalBigInt }
      });
      
      await publishEvent(CHANNELS.STATS_UPDATED, {
        event: 'SNAPSHOT_CONFIRMED',
        count: batchResult.count,
        gl0Ordinal,
        hash: confirmedHash,
      });
    }
    
  } catch (err) {
    console.error('❌ Error checking GL0 confirmations:', err);
  }
}

/**
 * Start the GL0 confirmation poller
 */
export function startConfirmationPoller(intervalMs = 5000): void {
  if (pollingInterval) {
    console.warn('⚠️ Confirmation poller already running');
    return;
  }
  
  console.log(`🔄 Starting GL0 confirmation poller (every ${intervalMs}ms)`);
  
  // Initial check
  checkConfirmations();
  
  // Start polling
  pollingInterval = setInterval(checkConfirmations, intervalMs);
}

/**
 * Stop the GL0 confirmation poller
 */
export function stopConfirmationPoller(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('🛑 Stopped GL0 confirmation poller');
  }
}

/**
 * Get confirmation stats
 */
export async function getConfirmationStats() {
  const [pending, confirmed, orphaned] = await Promise.all([
    prisma.indexedSnapshot.count({ where: { status: 'PENDING' } }),
    prisma.indexedSnapshot.count({ where: { status: 'CONFIRMED' } }),
    prisma.indexedSnapshot.count({ where: { status: 'ORPHANED' } }),
  ]);
  
  const latestConfirmed = await prisma.indexedSnapshot.findFirst({
    where: { status: 'CONFIRMED' },
    orderBy: { ordinal: 'desc' }
  });
  
  return {
    pending,
    confirmed,
    orphaned,
    latestConfirmedOrdinal: latestConfirmed ? Number(latestConfirmed.ordinal) : null,
    latestConfirmedAt: latestConfirmed?.confirmedAt ?? null,
  };
}
