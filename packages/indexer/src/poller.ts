/**
 * Lightweight ML0 Snapshot Poller (Fallback)
 * 
 * Low-frequency backup for webhook push. Catches any missed snapshots.
 * Also tracks (ordinal, hash) per ML0 peer for fork detection.
 */

import { prisma, getConfig } from '@ottochain/shared';
import { processSnapshot } from './processor.js';

// Default production ML0 peers — override via ML0_PEER_URLS env var
// Format: ML0_PEER_URLS="http://ml0-0:9200,http://ml0-1:9200"
// Falls back to METAGRAPH_ML0_URL as single peer if neither is set
const DEFAULT_PEERS = [
  { name: 'node1', url: 'http://5.78.90.207:9200' },
  { name: 'node2', url: 'http://5.78.113.25:9200' },
  { name: 'node3', url: 'http://5.78.107.77:9200' },
];

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
 * Poll a single ML0 peer for its latest snapshot info
 */
async function pollPeer(peer: { name: string; url: string }): Promise<PeerSnapshot | null> {
  try {
    const resp = await fetch(`${peer.url}/data-application/v1/checkpoint`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    
    const data = await resp.json() as { ordinal: number; state: any };
    
    // Get snapshot hash from the node info
    const infoResp = await fetch(`${peer.url}/node/info`, {
      signal: AbortSignal.timeout(5000),
    });
    const info = infoResp.ok ? await infoResp.json() as { state?: string } : null;
    
    return {
      ordinal: data.ordinal,
      hash: info?.state ?? 'unknown',
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
  const peers = Array.from(peerState.entries());
  if (peers.length < 2) return;
  
  // Group by ordinal
  const byOrdinal = new Map<number, string[]>();
  for (const [name, state] of peers) {
    const names = byOrdinal.get(state.ordinal) || [];
    names.push(name);
    byOrdinal.set(state.ordinal, names);
  }
  
  // Check peers at the same ordinal for hash divergence
  for (const [name1, state1] of peers) {
    for (const [name2, state2] of peers) {
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
    where: { ordinal: BigInt(maxOrdinal) }
  });
  
  if (existing) {
    lastPolledOrdinal = maxOrdinal;
    return; // Already indexed via webhook
  }
  
  // Missed snapshot — fetch and index it
  console.log(`🔄 Poller catchup: indexing missed snapshot ${maxOrdinal}`);
  
  try {
    const resp = await fetch(`${primaryUrl}/data-application/v1/checkpoint`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return;
    
    const data = await resp.json() as { ordinal: number; state: any };
    
    await processSnapshot({
      ordinal: data.ordinal,
      hash: 'polled',
      timestamp: new Date().toISOString(),
    });
    
    console.log(`✅ Poller indexed missed snapshot ${data.ordinal}`);
    lastPolledOrdinal = data.ordinal;
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
      ])
    ),
  };
}
