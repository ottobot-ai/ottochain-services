// Snapshot Processor
// Fetches full snapshot data from metagraph and indexes to Postgres

import { prisma, getConfig, type SnapshotNotification } from '@ottochain/shared';

interface ProcessResult {
  ordinal: number;
  agentsUpdated: number;
  contractsUpdated: number;
}

interface MetagraphState {
  stateMachines: Record<string, StateMachineFiber>;
  scripts: Record<string, ScriptFiber>;
}

interface StateMachineFiber {
  id: string;
  status: string;
  state: Record<string, unknown>;
  schema?: string;
}

interface ScriptFiber {
  id: string;
  status: string;
  state: Record<string, unknown>;
}

/**
 * Process a snapshot notification:
 * 1. Fetch current state from metagraph
 * 2. Extract AgentIdentity and Contract fibers
 * 3. Upsert to Postgres
 */
export async function processSnapshot(notification: SnapshotNotification): Promise<ProcessResult> {
  const config = getConfig();
  
  // Fetch current calculated state from ML0
  const stateUrl = `${config.METAGRAPH_ML0_URL}/data-application/v1/checkpoint`;
  const response = await fetch(stateUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch state: ${response.status} ${response.statusText}`);
  }
  
  const checkpoint = await response.json() as { state: MetagraphState };
  const { stateMachines } = checkpoint.state;
  
  let agentsUpdated = 0;
  let contractsUpdated = 0;
  
  // Process each state machine
  for (const [fiberId, fiber] of Object.entries(stateMachines)) {
    const schema = fiber.state?.schema as string | undefined;
    
    if (schema === 'AgentIdentity') {
      await indexAgent(fiberId, fiber, notification.ordinal);
      agentsUpdated++;
    } else if (schema === 'Contract') {
      await indexContract(fiberId, fiber, notification.ordinal);
      contractsUpdated++;
    }
  }
  
  // Record indexed snapshot
  await prisma.indexedSnapshot.upsert({
    where: { ordinal: BigInt(notification.ordinal) },
    create: {
      ordinal: BigInt(notification.ordinal),
      hash: notification.hash,
      agentsUpdated,
      contractsUpdated,
    },
    update: {
      hash: notification.hash,
      agentsUpdated,
      contractsUpdated,
      indexedAt: new Date(),
    },
  });
  
  return {
    ordinal: notification.ordinal,
    agentsUpdated,
    contractsUpdated,
  };
}

async function indexAgent(fiberId: string, fiber: StateMachineFiber, ordinal: number): Promise<void> {
  const state = fiber.state as Record<string, unknown>;
  const data = state.data as Record<string, unknown> | undefined;
  
  if (!data) return;
  
  const address = data.address as string;
  const publicKey = data.publicKey as string;
  const displayName = data.displayName as string | undefined;
  const reputation = (data.reputation as number) ?? 10;
  const agentState = mapAgentState(fiber.status);
  
  await prisma.agent.upsert({
    where: { address },
    create: {
      address,
      publicKey,
      displayName,
      reputation,
      state: agentState,
      fiberId,
      snapshotOrdinal: BigInt(ordinal),
    },
    update: {
      displayName,
      reputation,
      state: agentState,
      snapshotOrdinal: BigInt(ordinal),
    },
  });
  
  // Index platform links if present
  const platforms = data.platforms as Array<{ platform: string; userId: string; username?: string }> | undefined;
  if (platforms) {
    const agent = await prisma.agent.findUnique({ where: { address } });
    if (agent) {
      for (const p of platforms) {
        await prisma.platformLink.upsert({
          where: {
            platform_platformUserId: {
              platform: p.platform.toUpperCase() as any,
              platformUserId: p.userId,
            },
          },
          create: {
            agentId: agent.id,
            platform: p.platform.toUpperCase() as any,
            platformUserId: p.userId,
            platformUsername: p.username,
          },
          update: {
            platformUsername: p.username,
          },
        });
      }
    }
  }
  
  // Index attestations if present
  const attestations = data.attestations as Array<{
    type: string;
    issuerAddress?: string;
    delta: number;
    reason?: string;
    txHash: string;
  }> | undefined;
  
  if (attestations) {
    const agent = await prisma.agent.findUnique({ where: { address } });
    if (agent) {
      for (const att of attestations) {
        // Check if attestation already exists
        const exists = await prisma.attestation.findFirst({
          where: { txHash: att.txHash },
        });
        
        if (!exists) {
          let issuerId: number | null = null;
          if (att.issuerAddress) {
            const issuer = await prisma.agent.findUnique({ where: { address: att.issuerAddress } });
            issuerId = issuer?.id ?? null;
          }
          
          await prisma.attestation.create({
            data: {
              agentId: agent.id,
              type: att.type.toUpperCase() as any,
              issuerId,
              delta: att.delta,
              reason: att.reason,
              txHash: att.txHash,
              snapshotOrdinal: BigInt(ordinal),
            },
          });
        }
      }
    }
  }
}

async function indexContract(fiberId: string, fiber: StateMachineFiber, ordinal: number): Promise<void> {
  const state = fiber.state as Record<string, unknown>;
  const data = state.data as Record<string, unknown> | undefined;
  
  if (!data) return;
  
  const contractId = data.contractId as string ?? fiberId;
  const proposerAddress = data.proposerAddress as string;
  const counterpartyAddress = data.counterpartyAddress as string;
  const terms = data.terms as Record<string, unknown> ?? {};
  const contractState = mapContractState(state.currentState as string);
  
  // Get or create agents
  const proposer = await prisma.agent.findUnique({ where: { address: proposerAddress } });
  const counterparty = await prisma.agent.findUnique({ where: { address: counterpartyAddress } });
  
  if (!proposer || !counterparty) {
    console.warn(`Contract ${contractId}: missing proposer or counterparty agent`);
    return;
  }
  
  await prisma.contract.upsert({
    where: { contractId },
    create: {
      contractId,
      proposerId: proposer.id,
      counterpartyId: counterparty.id,
      state: contractState,
      terms,
      fiberId,
      snapshotOrdinal: BigInt(ordinal),
    },
    update: {
      state: contractState,
      snapshotOrdinal: BigInt(ordinal),
      ...(contractState === 'ACTIVE' && { acceptedAt: new Date() }),
      ...(contractState === 'COMPLETED' && { completedAt: new Date() }),
    },
  });
}

function mapAgentState(fiberStatus: string): 'REGISTERED' | 'ACTIVE' | 'WITHDRAWN' {
  switch (fiberStatus.toLowerCase()) {
    case 'active':
      return 'ACTIVE';
    case 'completed':
    case 'failed':
      return 'WITHDRAWN';
    default:
      return 'REGISTERED';
  }
}

function mapContractState(currentState: string): 'PROPOSED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'DISPUTED' {
  switch (currentState?.toLowerCase()) {
    case 'proposed':
      return 'PROPOSED';
    case 'active':
      return 'ACTIVE';
    case 'completed':
      return 'COMPLETED';
    case 'rejected':
      return 'REJECTED';
    case 'disputed':
      return 'DISPUTED';
    default:
      return 'PROPOSED';
  }
}
