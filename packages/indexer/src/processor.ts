// Snapshot Processor
// Chain-agnostic indexing of all OttoChain state machines

import {
  prisma,
  getConfig,
  type SnapshotNotification,
  publishEvent,
  CHANNELS,
} from '@ottochain/shared';
import { OttoMetagraphClient } from '@ottochain/sdk';
import type { StateMachineFiberRecord } from '@ottochain/sdk/core';
import { AgentState as PrismaAgentState, ContractState as PrismaContractState } from '@prisma/client';

// ── Bridge callback helper ────────────────────────────────────────────────────

interface FiberNotification {
  fiberId: string;
  currentState: string;
  ordinal: number;
  status: string;
}

/**
 * Notify bridge of newly indexed fibers via its internal callback endpoint.
 *
 * Fire-and-forget: failures are logged but do NOT block snapshot indexing.
 * The bridge has its own safety timeout for callers that don't receive a push.
 */
async function notifyBridge(snapshotOrdinal: number, fibers: FiberNotification[]): Promise<void> {
  if (fibers.length === 0) return;

  const config = getConfig();
  // Default: derive from BRIDGE_URL (same host, /internal/indexer-notify)
  const callbackUrl = config.BRIDGE_CALLBACK_URL
    ?? `${config.BRIDGE_URL}/internal/indexer-notify`;

  try {
    const resp = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotOrdinal, fibers }),
      signal: AbortSignal.timeout(5_000), // 5s hard cap — don't stall the indexer
    });

    if (!resp.ok) {
      console.warn(`[processor] Bridge callback returned ${resp.status} for ordinal ${snapshotOrdinal}`);
    } else {
      const data = await resp.json() as { waiterssResolved?: number };
      if ((data.waiterssResolved ?? 0) > 0) {
        console.log(`[processor] Bridge resolved ${data.waiterssResolved} waiters for ordinal ${snapshotOrdinal}`);
      }
    }
  } catch (err) {
    // Network error or timeout — log and continue
    console.warn(`[processor] Bridge callback failed for ordinal ${snapshotOrdinal}: ${(err as Error).message}`);
  }
}

interface ProcessResult {
  ordinal: number;
  fibersUpdated: number;
  agentsUpdated: number;
  contractsUpdated: number;
  corporateUpdated: number;
}

/** Narrow metadata to a plain object so we can access .name / .description safely */
function fiberMetadata(fiber: StateMachineFiberRecord): { name?: string; description?: string } {
  const meta = fiber.definition?.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as { name?: string; description?: string };
  }
  return {};
}

/** Narrow stateData to a plain object */
function fiberStateData(fiber: StateMachineFiberRecord): Record<string, unknown> {
  const sd = fiber.stateData;
  if (sd && typeof sd === 'object' && !Array.isArray(sd)) {
    return sd as Record<string, unknown>;
  }
  return {};
}

let _metagraphClient: OttoMetagraphClient | null = null;

function getMetagraphClient(): OttoMetagraphClient {
  if (!_metagraphClient) {
    const config = getConfig();
    _metagraphClient = new OttoMetagraphClient({ ml0Url: config.METAGRAPH_ML0_URL });
  }
  return _metagraphClient;
}

/**
 * Process a snapshot notification:
 * 1. Fetch current calculated state from metagraph via SDK
 * 2. Index ALL state machines as generic Fibers
 * 3. Derive Agent records for AgentIdentity workflows
 * 4. Derive Contract records for Contract workflows
 */
export async function processSnapshot(notification: SnapshotNotification): Promise<ProcessResult> {
  const client = getMetagraphClient();

  // Fetch current calculated state from ML0 via SDK
  const checkpoint = await client.getCheckpoint();
  const { stateMachines, scripts } = checkpoint.state;

  const smCount = Object.keys(stateMachines || {}).length;
  const scriptCount = Object.keys(scripts || {}).length;
  console.log(`📊 Checkpoint ordinal ${checkpoint.ordinal}: ${smCount} state machines, ${scriptCount} scripts`);

  let fibersUpdated = 0;
  let agentsUpdated = 0;
  let contractsUpdated = 0;
  let corporateUpdated = 0;

  // Collected for push notification to bridge after indexing completes
  const indexedFibers: FiberNotification[] = [];
  
  // Index ALL state machines as generic Fibers
  for (const [fiberId, fiber] of Object.entries(stateMachines || {})) {
    const meta = fiberMetadata(fiber);
    const stateData = fiberStateData(fiber);
    const workflowType = meta.name || 'Unknown';
    const workflowDesc = meta.description || null;
    const currentState = fiber.currentState || 'unknown';
    const status = mapFiberStatus(fiber.status);

    const existingFiber = await prisma.fiber.findUnique({ where: { fiberId } });

    // Upsert the fiber
    await prisma.fiber.upsert({
      where: { fiberId },
      create: {
        fiberId,
        workflowType,
        workflowDesc,
        currentState,
        status,
        owners: fiber.owners || [],
        stateData: (stateData || {}) as any,
        definition: (fiber.definition || {}) as any,
        sequenceNumber: fiber.sequenceNumber || 0,
        createdOrdinal: BigInt(fiber.creationOrdinal || notification.ordinal),
        updatedOrdinal: BigInt(notification.ordinal),
      },
      update: {
        currentState,
        status,
        stateData: (stateData || {}) as any,
        sequenceNumber: fiber.sequenceNumber || 0,
        updatedOrdinal: BigInt(notification.ordinal),
      },
    });

    fibersUpdated++;

    // Collect for bridge push notification
    indexedFibers.push({ fiberId, currentState, ordinal: notification.ordinal, status });
    
    // Record transition if there's a new receipt
    if (fiber.lastReceipt && fiber.lastReceipt.success) {
      const existingTransition = await prisma.fiberTransition.findFirst({
        where: {
          fiberId,
          snapshotOrdinal: BigInt(notification.ordinal),
          eventName: fiber.lastReceipt.eventName,
        },
      });

      if (!existingTransition) {
        await prisma.fiberTransition.create({
          data: {
            fiberId,
            eventName: fiber.lastReceipt.eventName,
            fromState: fiber.lastReceipt.fromState,
            toState: fiber.lastReceipt.toState,
            success: fiber.lastReceipt.success,
            gasUsed: fiber.lastReceipt.gasUsed || 0,
            snapshotOrdinal: BigInt(notification.ordinal),
          },
        });

        // Publish activity
        await publishEvent(CHANNELS.ACTIVITY_FEED, {
          eventType: 'TRANSITION',
          timestamp: new Date().toISOString(),
          fiberId,
          workflowType,
          action: `${fiber.lastReceipt.eventName}: ${fiber.lastReceipt.fromState} → ${fiber.lastReceipt.toState}`,
        });
      }
    }

    // Derive Agent from AgentIdentity workflows
    if (workflowType === 'AgentIdentity' || stateData?.schema === 'AgentIdentity') {
      const updated = await deriveAgent(fiber, notification.ordinal);
      if (updated) agentsUpdated++;
    }

    // Derive Contract from Contract workflows
    if (workflowType === 'Contract' || stateData?.schema === 'Contract') {
      const updated = await deriveContract(fiber, notification.ordinal);
      if (updated) contractsUpdated++;
    }

    // Publish market updates for Market workflows
    if (workflowType === 'Market' || stateData?.schema === 'Market') {
      const marketPayload = {
        fiberId,
        marketType: stateData?.marketType,
        marketStatus: stateData?.status,
        currentState,
        totalCommitted: stateData?.totalCommitted,
        ordinal: notification.ordinal,
        updatedAt: new Date().toISOString(),
      };
      await publishEvent(CHANNELS.MARKET_UPDATED, marketPayload).catch((err) => {
        console.warn(`[processor] Market pubsub publish failed for ${fiberId}:`, err.message);
      });
      await publishEvent(`${CHANNELS.MARKET_UPDATED}:${fiberId}`, marketPayload).catch((err) => {
        console.warn(`[processor] Market pubsub publish failed for ${fiberId}:`, err.message);
      });
    }

    // Track Corporate Entity workflows (uses generic Fiber table + activity feed)
    if (
      workflowType === 'Entity' ||
      workflowType === 'Board' ||
      workflowType === 'Shareholders' ||
      workflowType === 'Officers' ||
      workflowType === 'Securities' ||
      workflowType === 'Compliance' ||
      workflowType === 'Proxy' ||
      stateData?.schema?.toString().startsWith('Corporate')
    ) {
      await trackCorporateActivity(fiber, notification.ordinal, existingFiber);
      corporateUpdated++;
    }
  }

  // Update indexed snapshot stats (preserve status - set by confirmation poller)
  await prisma.indexedSnapshot.upsert({
    where: { ordinal: BigInt(notification.ordinal) },
    create: {
      ordinal: BigInt(notification.ordinal),
      hash: notification.hash,
      status: 'PENDING', // Will be updated to CONFIRMED by GL0 poller
      fibersUpdated,
      agentsUpdated,
      contractsUpdated,
    },
    update: {
      // Don't overwrite status or confirmation fields
      fibersUpdated,
      agentsUpdated,
      contractsUpdated,
      indexedAt: new Date(),
    },
  });

  const result = { ordinal: notification.ordinal, fibersUpdated, agentsUpdated, contractsUpdated, corporateUpdated };
  console.log(
    `✅ Indexed snapshot ${notification.ordinal}: ${fibersUpdated} fibers, ` +
    `${agentsUpdated} agents, ${contractsUpdated} contracts, ${corporateUpdated} corporate`,
  );

  await publishEvent(CHANNELS.STATS_UPDATED, result);

  // Push-notify bridge of all indexed fibers (fire-and-forget, non-blocking)
  void notifyBridge(notification.ordinal, indexedFibers);

  return result;
}

/**
 * Derive an Agent record from an AgentIdentity fiber
 */
async function deriveAgent(fiber: StateMachineFiberRecord, ordinal: number): Promise<boolean> {
  const address = fiber.owners[0];
  if (!address) return false;

  const stateData = fiberStateData(fiber);
  const displayName = (stateData.displayName as string) || `Agent ${address.slice(3, 11)}`;
  const reputation = (stateData.reputation as number) ?? 10;
  const agentState = mapAgentState(stateData.status as string, fiber.currentState);

  const existing = await prisma.agent.findUnique({ where: { address } });

  if (!existing) {
    console.log(`  🆔 Creating agent: ${displayName} (${address.slice(0, 12)}...)`);
    await prisma.agent.create({
      data: {
        address,
        publicKey: address,
        displayName,
        reputation,
        state: agentState,
        fiberId: fiber.fiberId,
        snapshotOrdinal: BigInt(ordinal),
      },
    });

    // Initial reputation history
    const agent = await prisma.agent.findUnique({ where: { address } });
    if (agent) {
      await prisma.reputationHistory.create({
        data: {
          agentId: agent.id,
          reputation,
          delta: 0,
          reason: 'AgentIdentity registration',
          snapshotOrdinal: BigInt(ordinal),
        },
      });
    }

    await publishEvent(CHANNELS.AGENT_UPDATED, { address, displayName, reputation, state: agentState });
    return true;
  }

  // Update if changed
  if (existing.reputation !== reputation || existing.displayName !== displayName || existing.state !== agentState) {
    const repDelta = reputation - existing.reputation;

    await prisma.agent.update({
      where: { address },
      data: {
        displayName,
        reputation,
        state: agentState,
        fiberId: fiber.fiberId,
        snapshotOrdinal: BigInt(ordinal),
      },
    });

    if (repDelta !== 0) {
      await prisma.reputationHistory.create({
        data: {
          agentId: existing.id,
          reputation,
          delta: repDelta,
          reason: 'AgentIdentity state update',
          snapshotOrdinal: BigInt(ordinal),
        },
      });
    }

    await publishEvent(CHANNELS.AGENT_UPDATED, { address, displayName, reputation, state: agentState });
    return true;
  }

  return false;
}

/**
 * Derive a Contract record from a Contract fiber
 */
async function deriveContract(fiber: StateMachineFiberRecord, ordinal: number): Promise<boolean> {
  const stateData = fiberStateData(fiber);
  const proposerAddress = (stateData.proposer as string) || fiber.owners[0];
  const counterpartyAddress = (stateData.counterparty as string) || proposerAddress;

  if (!proposerAddress) return false;

  // Ensure agents exist
  const proposer = await prisma.agent.findUnique({ where: { address: proposerAddress } });
  const counterparty = await prisma.agent.findUnique({ where: { address: counterpartyAddress } });

  if (!proposer || !counterparty) {
    // Create placeholder agents if needed
    if (!proposer) {
      await prisma.agent.create({
        data: {
          address: proposerAddress,
          publicKey: proposerAddress,
          displayName: `Agent ${proposerAddress.slice(3, 11)}`,
          reputation: 10,
          state: 'ACTIVE',
          snapshotOrdinal: BigInt(ordinal),
        },
      });
    }
    if (!counterparty && counterpartyAddress !== proposerAddress) {
      await prisma.agent.create({
        data: {
          address: counterpartyAddress,
          publicKey: counterpartyAddress,
          displayName: `Agent ${counterpartyAddress.slice(3, 11)}`,
          reputation: 10,
          state: 'ACTIVE',
          snapshotOrdinal: BigInt(ordinal),
        },
      });
    }
  }

  const proposerAgent = await prisma.agent.findUnique({ where: { address: proposerAddress } });
  const counterpartyAgent = await prisma.agent.findUnique({ where: { address: counterpartyAddress } });

  if (!proposerAgent || !counterpartyAgent) return false;

  const contractState = mapContractState(fiber.currentState, fiber.status);

  await prisma.contract.upsert({
    where: { contractId: fiber.fiberId },
    create: {
      contractId: fiber.fiberId,
      proposerId: proposerAgent.id,
      counterpartyId: counterpartyAgent.id,
      state: contractState,
      terms: {
        title: stateData.title || 'Contract',
        description: stateData.description || '',
        ...(stateData.terms as Record<string, unknown> || {}),
      },
      fiberId: fiber.fiberId,
      snapshotOrdinal: BigInt(ordinal),
    },
    update: {
      state: contractState,
      terms: {
        title: stateData.title || 'Contract',
        description: stateData.description || '',
        ...(stateData.terms as Record<string, unknown> || {}),
      },
      snapshotOrdinal: BigInt(ordinal),
      ...(contractState === 'ACTIVE' && { acceptedAt: new Date() }),
      ...(contractState === 'COMPLETED' && { completedAt: new Date() }),
    },
  });

  await publishEvent(CHANNELS.CONTRACT_UPDATED, {
    contractId: fiber.fiberId,
    state: contractState,
  });

  return true;
}

/**
 * Track corporate governance activity.
 */
async function trackCorporateActivity(
  fiber: StateMachineFiberRecord,
  ordinal: number,
  existingFiber: { currentState: string } | null,
): Promise<void> {
  const stateData = fiberStateData(fiber);
  const meta = fiberMetadata(fiber);
  const workflowType = meta.name || 'Unknown';
  const currentState = fiber.currentState || 'unknown';
  const entityId = (stateData.entityId as string) || fiber.fiberId;
  const legalName = (stateData.legalName as string) || (stateData.name as string) || entityId;

  // Only publish if state changed
  if (existingFiber && existingFiber.currentState === currentState) return;

  const isNew = !existingFiber;
  const eventType = isNew ? 'CORPORATE_CREATED' : 'CORPORATE_UPDATED';

  if (isNew) {
    console.log(`  🏢 New corporate ${workflowType}: ${legalName} (${fiber.fiberId.slice(0, 12)}...)`);
  }

  await publishEvent(CHANNELS.ACTIVITY_FEED, {
    eventType,
    timestamp: new Date().toISOString(),
    fiberId: fiber.fiberId,
    workflowType: `Corporate/${workflowType}`,
    entityId,
    legalName,
    action: isNew
      ? `${workflowType} created: ${currentState}`
      : `${workflowType}: ${existingFiber?.currentState} → ${currentState}`,
  });
}

/** Map SDK FiberStatus ('Active'|'Archived'|'Failed') to Prisma FiberStatus enum */
function mapFiberStatus(status: string): 'ACTIVE' | 'ARCHIVED' | 'FAILED' {
  switch (status?.toLowerCase()) {
    case 'archived': return 'ARCHIVED';
    case 'failed':   return 'FAILED';
    default:         return 'ACTIVE';
  }
}

/**
 * Map metagraph state values to Prisma AgentState enum
 * On-chain states are UPPERCASE (REGISTERED, ACTIVE, etc.)
 */
function mapAgentState(stateDataStatus: string | undefined, currentState: string | undefined): PrismaAgentState {
  const state = (stateDataStatus || currentState || '').toUpperCase();

  switch (state) {
    case 'WITHDRAWN':  return PrismaAgentState.WITHDRAWN;
    case 'ACTIVE':     return PrismaAgentState.ACTIVE;
    case 'CHALLENGED': return PrismaAgentState.CHALLENGED;
    case 'SUSPENDED':  return PrismaAgentState.SUSPENDED;
    case 'PROBATION':  return PrismaAgentState.PROBATION;
    case 'REGISTERED':
    default:           return PrismaAgentState.REGISTERED;
  }
}

/**
 * Map metagraph state values to Prisma ContractState enum
 * On-chain states are UPPERCASE (PROPOSED, ACTIVE, etc.)
 */
function mapContractState(currentState: string | undefined, fiberStatus: string): PrismaContractState {
  // If fiber is archived/completed, the contract is done
  if (fiberStatus.toLowerCase() !== 'active') return PrismaContractState.COMPLETED;

  const state = (currentState || '').toUpperCase();

  switch (state) {
    case 'COMPLETED': return PrismaContractState.COMPLETED;
    case 'REJECTED':  return PrismaContractState.REJECTED;
    case 'CANCELLED': return PrismaContractState.CANCELLED;
    case 'DISPUTED':  return PrismaContractState.DISPUTED;
    case 'ACTIVE':    return PrismaContractState.ACTIVE;
    case 'PROPOSED':
    default:          return PrismaContractState.PROPOSED;
  }
}
