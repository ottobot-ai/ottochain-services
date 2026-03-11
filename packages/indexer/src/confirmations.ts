/**
 * GL0 Confirmation Poller
 *
 * Confirms ML0 metagraph snapshots by checking GL0 global snapshots.
 * Uses /global-snapshots/latest/combined (full accumulated state) to
 * reliably detect our metagraph — the incremental endpoint only contains
 * our metagraph in ~30% of GL0 snapshots.
 *
 * Key design decisions:
 *   - Uses /latest/combined to verify metagraph presence (never misses)
 *   - Scans a RANGE of GL0 ordinals to find which specific ordinals
 *     contain our metagraph's state channel data for provenance.
 *   - Batch-confirms: when we find our metagraph in GL0 ordinal N,
 *     confirm ALL pending ML0 snapshots with ordinal ≤ confirmed ordinal.
 *   - Orphans pending snapshots older than the latest confirmed.
 */

import { prisma, getConfig, publishEvent, CHANNELS } from '@ottochain/shared';
import { getIndexerRequired } from './config.js';

/**
 * GL0 /global-snapshots/latest/combined returns a tuple:
 * [Signed[GlobalSnapshot], SnapshotInfo]
 * We only need the first element (the signed snapshot).
 */
interface CombinedSnapshotElement {
  value: {
    ordinal: number;
    stateChannelSnapshots: Record<string, Array<{
      value: {
        lastSnapshotHash: string;
        content: number[];
      };
    }>>;
  };
}

/** Shape of an individual GL0 snapshot from /global-snapshots/{ordinal} */
interface GlobalSnapshot {
  value: {
    ordinal: number;
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
 * Fetch the latest combined GL0 snapshot (full accumulated state).
 * Returns null on network/HTTP errors.
 */
async function fetchCombinedSnapshot(gl0Url: string): Promise<CombinedSnapshotElement | null> {
  try {
    const resp = await fetch(`${gl0Url}/global-snapshots/latest/combined`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    const combined = await resp.json() as CombinedSnapshotElement[];
    return combined[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single GL0 snapshot by ordinal (or 'latest').
 * Returns null on network/HTTP errors.
 */
async function fetchGl0Snapshot(gl0Url: string, ordinal: number | 'latest'): Promise<GlobalSnapshot | null> {
  try {
    const resp = await fetch(`${gl0Url}/global-snapshots/${ordinal}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    return await resp.json() as GlobalSnapshot;
  } catch {
    return null;
  }
}

/**
 * Confirm a single ML0 snapshot against a GL0 ordinal, updating related
 * fibers and transitions with the GL0 ordinal for provenance.
 */
async function confirmSnapshot(
  ml0Ordinal: bigint,
  gl0Ordinal: number,
  confirmedHash: string,
): Promise<void> {
  const gl0OrdinalBigInt = BigInt(gl0Ordinal);

  await prisma.indexedSnapshot.update({
    where: { ordinal: ml0Ordinal },
    data: {
      status: 'CONFIRMED',
      gl0Ordinal: gl0OrdinalBigInt,
      confirmedAt: new Date(),
    },
  });

  // Backfill gl0Ordinal on fibers created/updated in this snapshot
  await prisma.fiber.updateMany({
    where: { createdOrdinal: ml0Ordinal, createdGl0Ordinal: null },
    data: { createdGl0Ordinal: gl0OrdinalBigInt },
  });
  await prisma.fiber.updateMany({
    where: { updatedOrdinal: ml0Ordinal, updatedGl0Ordinal: null },
    data: { updatedGl0Ordinal: gl0OrdinalBigInt },
  });

  // Backfill gl0Ordinal on fiber transitions in this snapshot
  await prisma.fiberTransition.updateMany({
    where: { snapshotOrdinal: ml0Ordinal, gl0Ordinal: null },
    data: { gl0Ordinal: gl0OrdinalBigInt },
  });
}

/**
 * Main confirmation check — uses /combined for reliable metagraph detection,
 * then scans individual GL0 ordinals for per-snapshot provenance.
 */
async function checkConfirmations(): Promise<void> {
  getConfig(); // ensure shared config is initialized
  const { GL0_URL: gl0Url, METAGRAPH_ID: metagraphId } = getIndexerRequired();

  try {
    // Use /combined to get latest ordinal and verify our metagraph exists.
    // This never misses — combined has full accumulated state.
    const combined = await fetchCombinedSnapshot(gl0Url);
    if (!combined) {
      console.warn('⚠️ Could not fetch GL0 combined snapshot');
      return;
    }

    const latestGl0Ordinal = combined.value.ordinal;

    // Nothing new since last check
    if (latestGl0Ordinal <= lastCheckedGl0Ordinal) {
      return;
    }

    // Quick check: is our metagraph even in the combined state?
    const combinedStateChannels = combined.value.stateChannelSnapshots ?? {};
    if (!combinedStateChannels[metagraphId]) {
      // Metagraph hasn't produced any snapshots yet — update cursor and skip
      lastCheckedGl0Ordinal = latestGl0Ordinal;
      return;
    }

    // Our metagraph exists in GL0 state. Now scan individual ordinals to find
    // which specific ones contain our metagraph data (for provenance tracking).
    // On first run (or after restart), don't scan the entire history.
    const scanFrom = lastCheckedGl0Ordinal > 0
      ? lastCheckedGl0Ordinal + 1
      : Math.max(1, latestGl0Ordinal - 50);

    // Cap scan range to avoid runaway fetches (max 100 per cycle)
    const scanTo = Math.min(latestGl0Ordinal, scanFrom + 99);

    let confirmedCount = 0;
    let highestConfirmedMl0Ordinal: bigint | null = null;

    for (let gl0Ord = scanFrom; gl0Ord <= scanTo; gl0Ord++) {
      const snapshot = await fetchGl0Snapshot(gl0Url, gl0Ord);
      if (!snapshot) continue;

      const stateChannels = snapshot.value.stateChannelSnapshots ?? {};
      const metagraphSnapshots = stateChannels[metagraphId];
      if (!metagraphSnapshots || metagraphSnapshots.length === 0) continue;

      // Our metagraph IS in this GL0 snapshot
      const latestEntry = metagraphSnapshots[metagraphSnapshots.length - 1];
      const confirmedHash = latestEntry.value.lastSnapshotHash;

      // Try to find the exact PENDING snapshot by hash
      let pending = await prisma.indexedSnapshot.findFirst({
        where: { hash: confirmedHash, status: 'PENDING' },
      });

      if (!pending) {
        // Hash won't match for polled snapshots (hash="polled").
        // Confirm the oldest PENDING snapshot instead.
        pending = await prisma.indexedSnapshot.findFirst({
          where: { status: 'PENDING' },
          orderBy: { ordinal: 'asc' },
        });
      }

      if (pending) {
        await confirmSnapshot(pending.ordinal, gl0Ord, confirmedHash);
        confirmedCount++;
        if (!highestConfirmedMl0Ordinal || pending.ordinal > highestConfirmedMl0Ordinal) {
          highestConfirmedMl0Ordinal = pending.ordinal;
        }

        console.log(`✅ Confirmed ML0 snapshot ${pending.ordinal} in GL0 ordinal ${gl0Ord} (hash: ${confirmedHash.slice(0, 12)}...)`);

        await publishEvent(CHANNELS.STATS_UPDATED, {
          event: 'SNAPSHOT_CONFIRMED',
          ml0Ordinal: Number(pending.ordinal),
          gl0Ordinal: gl0Ord,
          hash: confirmedHash,
        });
      }
    }

    // Update cursor to the end of the scanned range
    lastCheckedGl0Ordinal = scanTo;

    // Batch-confirm: if we confirmed anything, also confirm all older PENDING
    // snapshots (they were implicitly confirmed by a later GL0 snapshot).
    if (highestConfirmedMl0Ordinal) {
      const batchConfirmed = await prisma.indexedSnapshot.updateMany({
        where: {
          status: 'PENDING',
          ordinal: { lt: highestConfirmedMl0Ordinal },
        },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });

      if (batchConfirmed.count > 0) {
        confirmedCount += batchConfirmed.count;
        console.log(`✅ Batch-confirmed ${batchConfirmed.count} older snapshots (≤ ordinal ${highestConfirmedMl0Ordinal})`);
      }
    }

    // Detect orphaned snapshots (PENDING superseded by a confirmed chain).
    const latestConfirmed = await prisma.indexedSnapshot.findFirst({
      where: { status: 'CONFIRMED' },
      orderBy: { ordinal: 'desc' },
    });

    if (latestConfirmed) {
      const orphaned = await prisma.indexedSnapshot.updateMany({
        where: {
          status: 'PENDING',
          ordinal: { lt: latestConfirmed.ordinal },
        },
        data: { status: 'ORPHANED' },
      });

      if (orphaned.count > 0) {
        console.warn(
          `⚠️ Marked ${orphaned.count} snapshot(s) as ORPHANED (superseded by confirmed ordinal ${latestConfirmed.ordinal})`
        );
      }
    }

    if (confirmedCount > 0) {
      console.log(`📊 Confirmation cycle: ${confirmedCount} confirmed, scanned GL0 ${scanFrom}–${scanTo}`);
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
    orderBy: { ordinal: 'desc' },
  });

  return {
    pending,
    confirmed,
    orphaned,
    latestConfirmedOrdinal: latestConfirmed ? Number(latestConfirmed.ordinal) : null,
    latestConfirmedAt: latestConfirmed?.confirmedAt ?? null,
  };
}
