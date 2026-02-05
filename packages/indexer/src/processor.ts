// Snapshot Processor
// Chain-agnostic indexing of all OttoChain state machines

import { prisma, getConfig, type SnapshotNotification, publishEvent, CHANNELS } from '@ottochain/shared';

interface ProcessResult {
  ordinal: number;
  fibersUpdated: number;
  agentsUpdated: number;
  contractsUpdated: number;
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
  
  const result = { ordinal: notification.ordinal, fibersUpdated, agentsUpdated, contractsUpdated };
  console.log(`✅ Indexed snapshot ${notification.ordinal}: ${fibersUpdated} fibers, ${agentsUpdated} agents, ${contractsUpdated} contracts`);
  
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

function mapFiberStatus(status: string): 'ACTIVE' | 'ARCHIVED' | 'FAILED' {
  switch (status?.toLowerCase()) {
    case 'archived': return 'ARCHIVED';
    case 'failed': return 'FAILED';
    default: return 'ACTIVE';
  }
}

function mapAgentState(stateDataStatus: string | undefined, currentState: string | undefined): 'REGISTERED' | 'ACTIVE' | 'WITHDRAWN' {
  if (stateDataStatus === 'Withdrawn' || currentState === 'Withdrawn') return 'WITHDRAWN';
  if (stateDataStatus === 'Active' || currentState === 'Active') return 'ACTIVE';
  return 'REGISTERED';
}

function mapContractState(currentState: string | undefined, fiberStatus: string): 'PROPOSED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'DISPUTED' {
  if (fiberStatus !== 'Active') return 'COMPLETED';
  
  const state = currentState?.toLowerCase();
  if (!state) return 'PROPOSED';
  
  if (['completed', 'finished', 'delivered', 'approved', 'released'].includes(state)) return 'COMPLETED';
  if (['rejected', 'cancelled', 'failed'].includes(state)) return 'REJECTED';
  if (['disputed'].includes(state)) return 'DISPUTED';
  if (['active', 'accepted', 'in_progress', 'working'].includes(state)) return 'ACTIVE';
  
  return 'PROPOSED';
}
