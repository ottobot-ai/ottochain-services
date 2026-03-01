// ============================================================================
// Snapshot Transaction Indexer
// Records ALL OttochainMessages from snapshot blocks to OttochainEvent table
// Uses SDK codec to decode transactions
// ============================================================================

import { OttochainMessage } from '@ottochain/sdk';
import { prisma, publishEvent, CHANNELS } from '@ottochain/shared';
import { MessageType, Prisma } from '@prisma/client';

/**
 * Decode a transaction value from metagraph JSON format.
 * Metagraph uses PascalCase (CreateStateMachine), SDK expects camelCase (createStateMachine).
 */
function decodeTransaction(value: Record<string, unknown>): ReturnType<typeof OttochainMessage.fromJSON>['message'] {
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

interface DecodedBlock {
  proofs: Array<{ id: string; signature: string }>;
  value: {
    roundId: number;
    dataTransactions: Array<[{
      proofs: Array<{ id: string; signature: string }>;
      value: Record<string, unknown>;
    }]>;
    dataTransactionsHashes: string[];
  };
}

/**
 * Fetch snapshot by hash and index ALL OttochainMessages.
 */
export async function indexSnapshotByHash(
  ordinal: number,
  hash: string,
  ml0Url: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    createStateMachine: 0,
    transitionStateMachine: 0,
    archiveStateMachine: 0,
    createScript: 0,
    invokeScript: 0,
  };

  const existing = await prisma.indexedSnapshot.findFirst({ where: { hash } });
  if (existing) {
    console.log(`⏭️ Snapshot hash ${hash.slice(0, 16)}... already indexed`);
    return counts;
  }

  const snapshotResp = await fetch(`${ml0Url}/snapshots/${ordinal}`, {
    signal: AbortSignal.timeout(30000),
  });
  
  if (!snapshotResp.ok) {
    throw new Error(`Failed to fetch snapshot ${ordinal}: ${snapshotResp.status}`);
  }
  
  const snapshot = await snapshotResp.json() as SnapshotData;
  const blocks = snapshot.value?.dataApplication?.blocks || [];
  
  if (blocks.length === 0) return counts;
  
  console.log(`📦 Processing snapshot ${ordinal}: ${blocks.length} blocks`);

  for (const blockBytes of blocks) {
    const blockJson = String.fromCharCode(...blockBytes);
    const block: DecodedBlock = JSON.parse(blockJson);
    const roundId = block.value.roundId;
    
    for (let txIdx = 0; txIdx < block.value.dataTransactions.length; txIdx++) {
      const [tx] = block.value.dataTransactions[txIdx];
      const txHash = block.value.dataTransactionsHashes[txIdx] || `${hash}-${roundId}-${txIdx}`;
      const signer = tx.proofs[0]?.id || 'unknown';
      
      const message = decodeTransaction(tx.value);
      if (!message) continue;
      
      const existingEvent = await prisma.ottochainEvent.findUnique({
        where: { transactionHash: txHash }
      });
      if (existingEvent) continue;

      const baseData = {
        snapshotOrdinal: BigInt(ordinal),
        snapshotHash: hash,
        blockRoundId: roundId,
        transactionHash: txHash,
        signer,
      };

      switch (message.$case) {
        case 'createStateMachine': {
          const { fiberId, definition, initialData, parentFiberId } = message.createStateMachine;
          await prisma.ottochainEvent.create({
            data: {
              ...baseData,
              messageType: MessageType.CREATE_STATE_MACHINE,
              fiberId,
              payload: { definition, initialData, parentFiberId } as Prisma.InputJsonValue,
            },
          });
          counts.createStateMachine++;
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'CREATE_STATE_MACHINE',
            timestamp: new Date().toISOString(),
            fiberId,
            workflowType: definition?.metadata?.name || 'Unknown',
            signer,
          });
          break;
        }
        
        case 'transitionStateMachine': {
          const { fiberId, eventName, payload, targetSequenceNumber } = message.transitionStateMachine;
          await prisma.ottochainEvent.create({
            data: {
              ...baseData,
              messageType: MessageType.TRANSITION_STATE_MACHINE,
              fiberId,
              eventName,
              targetSeqNum: targetSequenceNumber,
              payload: { payload } as Prisma.InputJsonValue,
            },
          });
          counts.transitionStateMachine++;
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'TRANSITION_STATE_MACHINE',
            timestamp: new Date().toISOString(),
            fiberId,
            eventName,
            signer,
          });
          break;
        }
        
        case 'archiveStateMachine': {
          const { fiberId, targetSequenceNumber } = message.archiveStateMachine;
          await prisma.ottochainEvent.create({
            data: {
              ...baseData,
              messageType: MessageType.ARCHIVE_STATE_MACHINE,
              fiberId,
              targetSeqNum: targetSequenceNumber,
              payload: {} as Prisma.InputJsonValue,
            },
          });
          counts.archiveStateMachine++;
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'ARCHIVE_STATE_MACHINE',
            timestamp: new Date().toISOString(),
            fiberId,
            signer,
          });
          break;
        }
        
        case 'createScript': {
          const { fiberId, scriptProgram, initialState, accessControl } = message.createScript;
          await prisma.ottochainEvent.create({
            data: {
              ...baseData,
              messageType: MessageType.CREATE_SCRIPT,
              fiberId,
              payload: { scriptProgram, initialState, accessControl } as Prisma.InputJsonValue,
            },
          });
          counts.createScript++;
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'CREATE_SCRIPT',
            timestamp: new Date().toISOString(),
            fiberId,
            signer,
          });
          break;
        }
        
        case 'invokeScript': {
          const { fiberId, method, args, targetSequenceNumber } = message.invokeScript;
          await prisma.ottochainEvent.create({
            data: {
              ...baseData,
              messageType: MessageType.INVOKE_SCRIPT,
              fiberId,
              method,
              targetSeqNum: targetSequenceNumber,
              payload: { args } as Prisma.InputJsonValue,
            },
          });
          counts.invokeScript++;
          await publishEvent(CHANNELS.ACTIVITY_FEED, {
            eventType: 'INVOKE_SCRIPT',
            timestamp: new Date().toISOString(),
            fiberId,
            method,
            signer,
          });
          break;
        }
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) console.log(`📝 Indexed ${total} events from snapshot ${ordinal}:`, counts);
  return counts;
}
