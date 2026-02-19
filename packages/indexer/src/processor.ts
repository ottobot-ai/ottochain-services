// Snapshot Processor
// Chain-agnostic indexing of all OttoChain state machines

import { 
  prisma, 
  getConfig, 
  type SnapshotNotification, 
  publishEvent, 
  CHANNELS,
} from '@ottochain/shared';
import { AgentState as PrismaAgentState, ContractState as PrismaContractState } from '@prisma/client';

interface ProcessResult {
  ordinal: number;
  fibersUpdated: number;
  agentsUpdated: number;
  contractsUpdated: number;
  corporateUpdated: number;
}

interface MetagraphState {
  stateMachines: Record<string, StateMachineFiber>;
  scripts: Record<string, ScriptFiber>;
}

interface StateMachineFiber {
  fiberId: string;
  status: string;
  currentState: { value: string };
  stateData: Record<string, unknown>;
  definition: {
    states: Record<string, unknown>;
    initialState: { value: string };
    transitions: Array<{
      from: { value: string };
      to: { value: string };
      eventName: string;
    }>;
    metadata?: { name?: string; description?: string };
  };
  owners: string[];
  sequenceNumber: number;
  creationOrdinal: { value: number };
  latestUpdateOrdinal: { value: number };
  lastReceipt?: {
    eventName: string;
    fromState: { value: string };
    toState: { value: string };
    success: boolean;
    gasUsed: number;
  };
}

interface ScriptFiber {
  fiberId: string;
  status: string;
  owners: string[];
}

/**
 * Process a snapshot notification:
 * 1. Fetch current state from metagraph
 * 2. Index ALL state machines as generic Fibers
 * 3. Derive Agent records for AgentIdentity workflows
 * 4. Derive Contract records for Contract workflows
 */
export async function processSnapshot(notification: SnapshotNotification): Promise<ProcessResult> {
  const config = getConfig();
  
  // Fetch current calculated state from ML0
  const stateUrl = `${config.METAGRAPH_ML0_URL}/data-application/v1/checkpoint`;
  const response = await fetch(stateUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch state: ${response.status} ${response.statusText}`);
  }
  
  const checkpoint = await response.json() as { state: MetagraphState; ordinal: number };
  const { stateMachines, scripts } = checkpoint.state;
  
  const smCount = Object.keys(stateMachines || {}).length;
  const scriptCount = Object.keys(scripts || {}).length;
  console.log(`📊 Checkpoint ordinal ${checkpoint.ordinal}: ${smCount} state machines, ${scriptCount} scripts`);
  
  let fibersUpdated = 0;
  let agentsUpdated = 0;
  let contractsUpdated = 0;
  let corporateUpdated = 0;
  
  // Index ALL state machines as generic Fibers
  for (const [fiberId, fiber] of Object.entries(stateMachines || {})) {
    const workflowType = fiber.definition?.metadata?.name || 'Unknown';
    const workflowDesc = fiber.definition?.metadata?.description || null;
    const currentState = fiber.currentState?.value || 'unknown';
    const status = mapFiberStatus(fiber.status);
    
    const existingFiber = await prisma.fiber.findUnique({ where: { fiberId } });
    
    // Upsert the fiber (cast to Prisma.InputJsonValue)
    await prisma.fiber.upsert({
      where: { fiberId },
      create: {
        fiberId,
        workflowType,
        workflowDesc,
        currentState,
        status,
        owners: fiber.owners || [],
        stateData: (fiber.stateData || {}) as any,
        definition: (fiber.definition || {}) as any,
        sequenceNumber: fiber.sequenceNumber || 0,
        createdOrdinal: BigInt(fiber.creationOrdinal?.value || notification.ordinal),
        updatedOrdinal: BigInt(notification.ordinal),
      },
      update: {
        currentState,
        status,
        stateData: (fiber.stateData || {}) as any,
        sequenceNumber: fiber.sequenceNumber || 0,
        updatedOrdinal: BigInt(notification.ordinal),
      },
    });
    
    fibersUpdated++;
    
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
            fromState: fiber.lastReceipt.fromState.value,
            toState: fiber.lastReceipt.toState.value,
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
          action: `${fiber.lastReceipt.eventName}: ${fiber.lastReceipt.fromState.value} → ${fiber.lastReceipt.toState.value}`,
        });
      }
    }
    
    // Derive Agent from AgentIdentity workflows
    if (workflowType === 'AgentIdentity' || fiber.stateData?.schema === 'AgentIdentity') {
      const updated = await deriveAgent(fiber, notification.ordinal);
      if (updated) agentsUpdated++;
    }
    
    // Derive Contract from Contract workflows
    if (workflowType === 'Contract' || fiber.stateData?.schema === 'Contract') {
      const updated = await deriveContract(fiber, notification.ordinal);
      if (updated) contractsUpdated++;
    }

    // Publish market updates for Market workflows
    if (workflowType === 'Market' || fiber.stateData?.schema === 'Market') {
      // Publish to both the global market channel and the market-specific channel
      const marketPayload = {
        fiberId,
        marketType: fiber.stateData?.marketType,
        marketStatus: fiber.stateData?.status,
        currentState,
        totalCommitted: fiber.stateData?.totalCommitted,
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
    if (workflowType === 'Entity' || workflowType === 'Board' || workflowType === 'Shareholders' ||
        workflowType === 'Officers' || workflowType === 'Securities' || workflowType === 'Compliance' ||
        workflowType === 'Proxy' || fiber.stateData?.schema?.toString().startsWith('Corporate')) {
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
  console.log(`✅ Indexed snapshot ${notification.ordinal}: ${fibersUpdated} fibers, ${agentsUpdated} agents, ${contractsUpdated} contracts, ${corporateUpdated} corporate`);
  
  await publishEvent(CHANNELS.STATS_UPDATED, result);
  return result;
}

/**
 * Derive an Agent record from an AgentIdentity fiber
 */
async function deriveAgent(fiber: StateMachineFiber, ordinal: number): Promise<boolean> {
  const address = fiber.owners[0];
  if (!address) return false;
  
  const stateData = fiber.stateData || {};
  const displayName = (stateData.displayName as string) || `Agent ${address.slice(3, 11)}`;
  const reputation = (stateData.reputation as number) ?? 10;
  const agentState = mapAgentState(stateData.status as string, fiber.currentState?.value);
  
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
async function deriveContract(fiber: StateMachineFiber, ordinal: number): Promise<boolean> {
  const stateData = fiber.stateData || {};
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
  
  const contractState = mapContractState(fiber.currentState?.value, fiber.status);
  
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
        ...(stateData.terms || {}),
      },
      fiberId: fiber.fiberId,
      snapshotOrdinal: BigInt(ordinal),
    },
    update: {
      state: contractState,
      terms: {
        title: stateData.title || 'Contract',
        description: stateData.description || '',
        ...(stateData.terms || {}),
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
 * Corporate entities use multiple linked fibers (Entity, Board, Shareholders, Officers, etc.).
 * Data is stored in the generic Fiber table; this function publishes activity events
 * for real-time monitoring and links related fibers via stateData.entityId.
 */
async function trackCorporateActivity(
  fiber: StateMachineFiber, 
  ordinal: number,
  existingFiber: { currentState: string } | null,
): Promise<void> {
  const stateData = fiber.stateData || {};
  const workflowType = fiber.definition?.metadata?.name || 'Unknown';
  const currentState = fiber.currentState?.value || 'unknown';
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

function mapFiberStatus(status: string): 'ACTIVE' | 'ARCHIVED' | 'FAILED' {
  switch (status?.toLowerCase()) {
    case 'archived': return 'ARCHIVED';
    case 'failed': return 'FAILED';
    default: return 'ACTIVE';
  }
}

/**
 * Map metagraph state values to Prisma AgentState enum
 * On-chain states are UPPERCASE (REGISTERED, ACTIVE, etc.)
 */
function mapAgentState(stateDataStatus: string | undefined, currentState: string | undefined): PrismaAgentState {
  const state = (stateDataStatus || currentState || '').toUpperCase();
  
  switch (state) {
    case 'WITHDRAWN': return PrismaAgentState.WITHDRAWN;
    case 'ACTIVE': return PrismaAgentState.ACTIVE;
    case 'CHALLENGED': return PrismaAgentState.CHALLENGED;
    case 'SUSPENDED': return PrismaAgentState.SUSPENDED;
    case 'PROBATION': return PrismaAgentState.PROBATION;
    case 'REGISTERED':
    default: return PrismaAgentState.REGISTERED;
  }
}

/**
 * Map metagraph state values to Prisma ContractState enum
 * On-chain states are UPPERCASE (PROPOSED, ACTIVE, etc.)
 */
function mapContractState(currentState: string | undefined, fiberStatus: string): PrismaContractState {
  // If fiber is archived/completed, the contract is done
  if (fiberStatus !== 'ACTIVE') return PrismaContractState.COMPLETED;
  
  const state = (currentState || '').toUpperCase();
  
  switch (state) {
    case 'COMPLETED': return PrismaContractState.COMPLETED;
    case 'REJECTED': return PrismaContractState.REJECTED;
    case 'CANCELLED': return PrismaContractState.CANCELLED;
    case 'DISPUTED': return PrismaContractState.DISPUTED;
    case 'ACTIVE': return PrismaContractState.ACTIVE;
    case 'PROPOSED':
    default: return PrismaContractState.PROPOSED;
  }
}
