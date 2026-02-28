// ============================================================================
// Snapshot Transaction Indexer
// Uses SDK codec to decode transactions from snapshot blocks
// ============================================================================

import { OttochainMessage, CreateStateMachine, TransitionStateMachine } from '@ottochain/sdk';
import { prisma, publishEvent, CHANNELS } from '@ottochain/shared';

/**
 * Decode a transaction value from metagraph JSON format.
 * Metagraph uses PascalCase (CreateStateMachine), SDK expects camelCase (createStateMachine).
 */
function decodeTransaction(value: Record<string, unknown>): ReturnType<typeof OttochainMessage.fromJSON>['message'] {
  // Transform PascalCase keys to camelCase for SDK compatibility
  const transformed: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
    transformed[camelKey] = val;
  }
  return OttochainMessage.fromJSON(transformed).message;
}

interface SnapshotData {
  value: {
    ordinal: number;
    dataApplication?: {
      blocks: number[][];
    };
  };
}

/**
 * Fetch snapshot by ordinal and index all transactions.
 * Returns number of transitions recorded.
 */
export async function indexSnapshotByHash(
  ordinal: number,
  hash: string,
  ml0Url: string
): Promise<{ transitionsRecorded: number; fibersCreated: number }> {
  let transitionsRecorded = 0;
  let fibersCreated = 0;

  // Check if we've already indexed this hash
  const existing = await prisma.indexedSnapshot.findFirst({
    where: { hash }
  });
  
  if (existing) {
    console.log(`⏭️ Snapshot hash ${hash.slice(0, 16)}... already indexed at ordinal ${existing.ordinal}`);
    return { transitionsRecorded: 0, fibersCreated: 0 };
  }

  // Fetch the actual snapshot
  const snapshotResp = await fetch(`${ml0Url}/snapshots/${ordinal}`, {
    signal: AbortSignal.timeout(30000),
  });
  
  if (!snapshotResp.ok) {
    throw new Error(`Failed to fetch snapshot ${ordinal}: ${snapshotResp.status}`);
  }
  
  const snapshot = await snapshotResp.json() as SnapshotData;
  const blocks = snapshot.value?.dataApplication?.blocks || [];
  
  console.log(`📦 Processing snapshot ${ordinal} (${hash.slice(0, 16)}...): ${blocks.length} blocks`);

  for (const blockBytes of blocks) {
    // Decode block from byte array to JSON
    const blockJson = String.fromCharCode(...blockBytes);
    const block = JSON.parse(blockJson) as {
      value: {
        dataTransactions: Array<[{ proofs: unknown[]; value: Record<string, unknown> }]>;
      };
    };
    
    for (const [tx] of block.value.dataTransactions) {
      const message = decodeTransaction(tx.value);
      
      if (!message) continue;
      
      switch (message.$case) {
        case 'createStateMachine': {
          const { fiberId, definition } = message.createStateMachine;
          const initialState = definition?.initialState || 'UNKNOWN';
          const workflowType = definition?.metadata?.name || 'Unknown';
          
          // Record CREATED transition
          await prisma.fiberTransition.create({
            data: {
              fiberId,
              eventName: 'CREATED',
              fromState: 'NONE',
              toState: initialState,
              success: true,
              gasUsed: 0,
              snapshotOrdinal: BigInt(ordinal),
            },
          });
          
          transitionsRecorded++;
          fibersCreated++;
          
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'CREATION',
            timestamp: new Date().toISOString(),
            fiberId,
            workflowType,
            action: `Created → ${initialState}`,
          });
          break;
        }
        
        case 'transitionStateMachine': {
          const { fiberId, eventName } = message.transitionStateMachine;
          
          // Get current fiber state (result of this transition)
          const fiber = await prisma.fiber.findUnique({ where: { fiberId } });
          if (!fiber) {
            console.warn(`⚠️ TransitionStateMachine for unknown fiber ${fiberId}`);
            continue;
          }
          
          await prisma.fiberTransition.create({
            data: {
              fiberId,
              eventName,
              fromState: 'UNKNOWN', // Would need state tracking for accurate fromState
              toState: fiber.currentState,
              success: true,
              gasUsed: 0,
              snapshotOrdinal: BigInt(ordinal),
            },
          });
          
          transitionsRecorded++;
          
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'TRANSITION',
            timestamp: new Date().toISOString(),
            fiberId,
            workflowType: fiber.workflowType,
            action: `${eventName} → ${fiber.currentState}`,
          });
          break;
        }
        
        case 'archiveStateMachine': {
          const { fiberId } = message.archiveStateMachine;
          
          await prisma.fiberTransition.create({
            data: {
              fiberId,
              eventName: 'ARCHIVED',
              fromState: 'UNKNOWN',
              toState: 'ARCHIVED',
              success: true,
              gasUsed: 0,
              snapshotOrdinal: BigInt(ordinal),
            },
          });
          
          transitionsRecorded++;
          break;
        }
        
        // Scripts don't create fiber transitions
        case 'createScript':
        case 'invokeScript':
          break;
      }
    }
  }

  console.log(`📝 Indexed ${transitionsRecorded} transitions, ${fibersCreated} new fibers from snapshot ${ordinal}`);
  return { transitionsRecorded, fibersCreated };
}
