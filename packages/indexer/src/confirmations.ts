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
  const gl0Url = config.GL0_URL;
  const metagraphId = config.METAGRAPH_ID;
  
  if (!gl0Url) {
    console.warn('⚠️ GL0_URL not configured, skipping confirmation check');
    return;
  }
  
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
    const metagraphSnapshots = metagraphId ? stateChannels[metagraphId] : undefined;
    
    if (!metagraphSnapshots || metagraphSnapshots.length === 0) {
      // Our metagraph didn't produce a snapshot in this GL0 ordinal — normal, skip
      return;
    }
    
    // Our metagraph IS in this GL0 snapshot — confirm the latest pending
    const latestEntry = metagraphSnapshots[metagraphSnapshots.length - 1];
    const confirmedHash = latestEntry.value.lastSnapshotHash;
    
    // Find pending snapshots to confirm. Match by hash if possible, else confirm the oldest pending.
    let pending = await prisma.indexedSnapshot.findFirst({
      where: { hash: confirmedHash, status: 'PENDING' }
    });
    
    if (!pending) {
      // Hash might not match (webhook vs polled), just confirm the oldest pending
      pending = await prisma.indexedSnapshot.findFirst({
        where: { status: 'PENDING' },
        orderBy: { ordinal: 'asc' }
      });
    }
    
    if (pending) {
      const gl0OrdinalBigInt = BigInt(gl0Ordinal);
      
      // Update the indexed snapshot
      await prisma.indexedSnapshot.update({
        where: { ordinal: pending.ordinal },
        data: {
          status: 'CONFIRMED',
          gl0Ordinal: gl0OrdinalBigInt,
          confirmedAt: new Date(),
        }
      });
      
      // Backfill gl0Ordinal on fibers created/updated in this snapshot
      await prisma.fiber.updateMany({
        where: { createdOrdinal: pending.ordinal, createdGl0Ordinal: null },
        data: { createdGl0Ordinal: gl0OrdinalBigInt }
      });
      await prisma.fiber.updateMany({
        where: { updatedOrdinal: pending.ordinal, updatedGl0Ordinal: null },
        data: { updatedGl0Ordinal: gl0OrdinalBigInt }
      });
      
      // Backfill gl0Ordinal on fiber transitions in this snapshot
      await prisma.fiberTransition.updateMany({
        where: { snapshotOrdinal: pending.ordinal, gl0Ordinal: null },
        data: { gl0Ordinal: gl0OrdinalBigInt }
      });
      
      console.log(`✅ Confirmed ML0 snapshot ${pending.ordinal} in GL0 ordinal ${gl0Ordinal} (hash: ${confirmedHash.slice(0, 12)}...)`);
      
      await publishEvent(CHANNELS.STATS_UPDATED, {
        event: 'SNAPSHOT_CONFIRMED',
        ml0Ordinal: Number(pending.ordinal),
        gl0Ordinal,
        hash: confirmedHash,
      });
    }
    
    // Check for orphaned snapshots (pending for too long with newer confirmed)
    const latestConfirmed = await prisma.indexedSnapshot.findFirst({
      where: { status: 'CONFIRMED' },
      orderBy: { ordinal: 'desc' }
    });
    
    if (latestConfirmed) {
      // Mark older pending snapshots as orphaned
      const orphaned = await prisma.indexedSnapshot.updateMany({
        where: {
          status: 'PENDING',
          ordinal: { lt: latestConfirmed.ordinal }
        },
        data: { status: 'ORPHANED' }
      });
      
      if (orphaned.count > 0) {
        console.warn(`⚠️ Marked ${orphaned.count} snapshots as ORPHANED (superseded by ordinal ${latestConfirmed.ordinal})`);
      }
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
