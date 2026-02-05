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
    stateChannelSnapshots: Record<string, {
      snapshotBinary: string;
      snapshotInfo: {
        ordinal: number;
        hash: string;
      };
    }>;
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
    
    const globalSnapshot: GlobalSnapshot = await response.json();
    const gl0Ordinal = globalSnapshot.value.ordinal;
    
    // Skip if we've already checked this ordinal
    if (gl0Ordinal <= lastCheckedGl0Ordinal) {
      return;
    }
    lastCheckedGl0Ordinal = gl0Ordinal;
    
    // Check for metagraph snapshots
    const stateChannels = globalSnapshot.value.stateChannelSnapshots;
    
    // Find our metagraph by ID or check all state channels
    let confirmedHash: string | null = null;
    let confirmedMl0Ordinal: number | null = null;
    
    if (metagraphId && stateChannels[metagraphId]) {
      confirmedHash = stateChannels[metagraphId].snapshotInfo.hash;
      confirmedMl0Ordinal = stateChannels[metagraphId].snapshotInfo.ordinal;
    } else {
      // If no metagraph ID configured, check all state channels
      for (const [id, snapshot] of Object.entries(stateChannels)) {
        const hash = snapshot.snapshotInfo.hash;
        
        // Check if this hash matches any pending snapshot
        const pending = await prisma.indexedSnapshot.findFirst({
          where: { hash, status: 'PENDING' }
        });
        
        if (pending) {
          confirmedHash = hash;
          confirmedMl0Ordinal = snapshot.snapshotInfo.ordinal;
          console.log(`🔍 Found metagraph in state channel: ${id}`);
          break;
        }
      }
    }
    
    if (confirmedHash) {
      // Find and confirm the pending snapshot
      const pending = await prisma.indexedSnapshot.findFirst({
        where: { hash: confirmedHash, status: 'PENDING' }
      });
      
      if (pending) {
        await prisma.indexedSnapshot.update({
          where: { ordinal: pending.ordinal },
          data: {
            status: 'CONFIRMED',
            gl0Ordinal: BigInt(gl0Ordinal),
            confirmedAt: new Date(),
          }
        });
        
        console.log(`✅ Confirmed ML0 snapshot ${pending.ordinal} in GL0 ordinal ${gl0Ordinal}`);
        
        await publishEvent(CHANNELS.STATS_UPDATED, {
          event: 'SNAPSHOT_CONFIRMED',
          ml0Ordinal: Number(pending.ordinal),
          gl0Ordinal,
          hash: confirmedHash,
        });
      }
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
