/**
 * Lightweight ML0 Snapshot Poller (Fallback)
 *
 * Low-frequency backup for webhook push. Catches any missed snapshots.
 * Also tracks (ordinal, hash) per ML0 peer for fork detection.
 */

import { prisma, getConfig } from '@ottochain/shared';
import { OttoMetagraphClient } from '@ottochain/sdk';
import { processSnapshot } from './processor.js';

// ML0 peers for fork detection — configure via ML0_PEER_URLS env var
// Format: ML0_PEER_URLS="http://ml0-0:9200,http://ml0-1:9200,http://ml0-2:9200"
// Falls back to METAGRAPH_ML0_URL as single peer if neither is set
// No hardcoded defaults — environment must provide peer URLs

interface PeerConfig {
  name: string;
  url: string;
  client: OttoMetagraphClient;
}

function getML0Peers(): PeerConfig[] {
  const envPeers = process.env.ML0_PEER_URLS;
  if (envPeers) {
    return envPeers.split(',').map((url, i) => ({
      name: `peer${i}`,
      url: url.trim(),
      client: new OttoMetagraphClient({ ml0Url: url.trim(), timeout: 5000 }),
    }));
  }
  // Fall back to METAGRAPH_ML0_URL as single peer (CI, dev, production)
  const config = getConfig();
  if (config.METAGRAPH_ML0_URL) {
    return [{
      name: 'primary',
      url: config.METAGRAPH_ML0_URL,
      client: new OttoMetagraphClient({ ml0Url: config.METAGRAPH_ML0_URL, timeout: 5000 }),
    }];
  }
  throw new Error('ML0_PEER_URLS or METAGRAPH_ML0_URL must be set — no hardcoded defaults');
}

let ML0_PEERS: PeerConfig[] | null = null;
function peers(): PeerConfig[] {
  if (!ML0_PEERS) ML0_PEERS = getML0Peers();
  return ML0_PEERS;
}

function getML0Peers(): Array<{ name: string; url: string }> {
  const envPeers = process.env.ML0_PEER_URLS;
  if (envPeers) {
    return envPeers.split(',').map((url, i) => ({
      name: `peer${i}`,
      url: url.trim(),
    }));
  }
  // Fall back to METAGRAPH_ML0_URL as single peer (CI, dev)
  const config = getConfig();
  if (config.METAGRAPH_ML0_URL && !config.METAGRAPH_ML0_URL.includes('5.78.')) {
    return [{ name: 'primary', url: config.METAGRAPH_ML0_URL }];
  }
  return DEFAULT_PEERS;
}

let ML0_PEERS: Array<{ name: string; url: string }> | null = null;
function peers(): Array<{ name: string; url: string }> {
  if (!ML0_PEERS) ML0_PEERS = getML0Peers();
  return ML0_PEERS;
}

interface PeerSnapshot {
  ordinal: number;
  hash: string;
  lastSeen: Date;
}

// Track latest snapshot per peer for fork detection
const peerState: Map<string, PeerSnapshot> = new Map();

let pollingInterval: NodeJS.Timeout | null = null;
let lastPolledOrdinal = 0;

/**
 * Poll a single ML0 peer for its latest snapshot info via SDK
 */
async function pollPeer(peer: PeerConfig): Promise<PeerSnapshot | null> {
  try {
    const checkpoint = await peer.client.getCheckpoint();

    // Get a rough hash from node info (framework endpoint, not in SDK)
    let nodeHash = 'unknown';
    try {
      const infoResp = await fetch(`${peer.url}/node/info`, {
        signal: AbortSignal.timeout(5000),
      });
      if (infoResp.ok) {
        const info = await infoResp.json() as { state?: string };
        nodeHash = info?.state ?? 'unknown';
      }
    } catch {
      // Node info is best-effort for fork detection hashing
    }

    return {
      ordinal: checkpoint.ordinal,
      hash: nodeHash,
      lastSeen: new Date(),
    };
  } catch {
    return null;
  }
}

/**
 * Check all peers for fork divergence
 */
function checkForForks(): void {
  const peerList = Array.from(peerState.entries());
  if (peerList.length < 2) return;

  // Check peers at the same ordinal for hash divergence
  for (const [name1, state1] of peerList) {
    for (const [name2, state2] of peerList) {
      if (name1 >= name2) continue;
      if (state1.ordinal === state2.ordinal && state1.hash !== state2.hash) {
        console.error(`🔀 FORK DETECTED: ${name1} and ${name2} diverge at ordinal ${state1.ordinal}`);
        console.error(`   ${name1}: ${state1.hash}`);
        console.error(`   ${name2}: ${state2.hash}`);
      }
    }
  }
}

/**
 * Poll all peers and catch up on any missed snapshots
 */
async function pollOnce(): Promise<void> {
  const config = getConfig();
  const primaryUrl = config.METAGRAPH_ML0_URL;

  // Poll all peers for fork detection
  const results = await Promise.all(peers().map(async (peer) => {
    const snapshot = await pollPeer(peer);
    if (snapshot) {
      peerState.set(peer.name, snapshot);
    }
    return { peer: peer.name, snapshot };
  }));

  checkForForks();

  // Find the highest ordinal across peers
  const maxOrdinal = Math.max(...results
    .filter(r => r.snapshot)
    .map(r => r.snapshot!.ordinal));

  if (maxOrdinal <= lastPolledOrdinal || maxOrdinal <= 0) return;

  // Check if we've already indexed this ordinal (webhook may have handled it)
  const existing = await prisma.indexedSnapshot.findFirst({
    where: { ordinal: BigInt(maxOrdinal) },
  });

  if (existing) {
    lastPolledOrdinal = maxOrdinal;
    return; // Already indexed via webhook
  }

  // Missed snapshot — fetch and index it via the primary peer's SDK client
  console.log(`🔄 Poller catchup: indexing missed snapshot ${maxOrdinal}`);

  try {
    const primaryPeer = peers().find(p => p.name === 'primary') ?? peers()[0];
    const checkpoint = await primaryPeer.client.getCheckpoint();

    await processSnapshot({
      ordinal: checkpoint.ordinal,
      hash: 'polled',
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Poller indexed missed snapshot ${checkpoint.ordinal}`);
    lastPolledOrdinal = checkpoint.ordinal;
  } catch (err) {
    console.warn(`⚠️ Poller catchup failed: ${(err as Error).message}`);
  }
}

/**
 * Start the low-frequency fallback poller
 */
export function startSnapshotPoller(intervalMs = 60000): void {
  if (pollingInterval) {
    console.warn('⚠️ Snapshot poller already running');
    return;
  }

  const peerList = peers();
  console.log(`🔄 Starting fallback poller (every ${intervalMs / 1000}s) with ${peerList.length}-peer fork detection`);
  console.log(`   Peers: ${peerList.map(p => `${p.name}=${p.url}`).join(', ')}`);

  // Initial poll
  pollOnce().catch(console.error);

  pollingInterval = setInterval(() => pollOnce().catch(console.error), intervalMs);
}

/**
 * Stop the fallback poller
 */
export function stopSnapshotPoller(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('🛑 Stopped fallback poller');
  }
}

/**
 * Get poller stats including per-peer state
 */
export function getPollerStats() {
  return {
    lastPolledOrdinal,
    isRunning: pollingInterval !== null,
    peers: Object.fromEntries(
      Array.from(peerState.entries()).map(([name, state]) => [
        name,
        { ordinal: state.ordinal, hash: state.hash, lastSeen: state.lastSeen },
      ]),
    ),
  };
}
