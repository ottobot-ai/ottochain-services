// GraphQL Resolvers

import { prisma, getBridgeClient } from '@ottochain/shared';
import { pubsub, CHANNELS } from './pubsub.js';
import type { Context } from './context.js';

// Subscription event names
export const EVENTS = {
  AGENT_UPDATED: 'AGENT_UPDATED',
  NEW_ATTESTATION: 'NEW_ATTESTATION',
  CONTRACT_UPDATED: 'CONTRACT_UPDATED',
  ACTIVITY_FEED: 'ACTIVITY_FEED',
  STATS_UPDATED: 'STATS_UPDATED',
} as const;

export const resolvers = {
  // === Queries ===
  Query: {
    agent: async (_: unknown, { address }: { address: string }) => {
      return prisma.agent.findUnique({ where: { address } });
    },

    agentByPlatform: async (
      _: unknown,
      { platform, userId }: { platform: string; userId: string }
    ) => {
      const link = await prisma.platformLink.findUnique({
        where: { platform_platformUserId: { platform: platform as any, platformUserId: userId } },
        include: { agent: true },
      });
      return link?.agent ?? null;
    },

    agents: async (
      _: unknown,
      {
        state,
        minReputation,
        maxReputation,
        limit = 20,
        offset = 0,
        orderBy = 'REPUTATION_DESC',
      }: {
        state?: string;
        minReputation?: number;
        maxReputation?: number;
        limit?: number;
        offset?: number;
        orderBy?: string;
      }
    ) => {
      const orderByMap: Record<string, any> = {
        REPUTATION_DESC: { reputation: 'desc' },
        REPUTATION_ASC: { reputation: 'asc' },
        CREATED_DESC: { createdAt: 'desc' },
        CREATED_ASC: { createdAt: 'asc' },
        NAME_ASC: { displayName: 'asc' },
      };

      return prisma.agent.findMany({
        where: {
          ...(state && { state: state as any }),
          ...(minReputation !== undefined && { reputation: { gte: minReputation } }),
          ...(maxReputation !== undefined && { reputation: { lte: maxReputation } }),
        },
        orderBy: orderByMap[orderBy] ?? { reputation: 'desc' },
        take: limit,
        skip: offset,
      });
    },

    leaderboard: async (_: unknown, { limit = 10 }: { limit?: number }) => {
      return prisma.agent.findMany({
        where: { state: 'ACTIVE' },
        orderBy: { reputation: 'desc' },
        take: limit,
      });
    },

    contract: async (_: unknown, { contractId }: { contractId: string }) => {
      return prisma.contract.findUnique({ where: { contractId } });
    },

    contracts: async (
      _: unknown,
      {
        agentAddress,
        state,
        limit = 20,
        offset = 0,
      }: {
        agentAddress?: string;
        state?: string;
        limit?: number;
        offset?: number;
      }
    ) => {
      let agentId: number | undefined;
      if (agentAddress) {
        const agent = await prisma.agent.findUnique({ where: { address: agentAddress } });
        agentId = agent?.id;
      }

      return prisma.contract.findMany({
        where: {
          ...(state && { state: state as any }),
          ...(agentId && {
            OR: [{ proposerId: agentId }, { counterpartyId: agentId }],
          }),
        },
        orderBy: { proposedAt: 'desc' },
        take: limit,
        skip: offset,
      });
    },

    recentActivity: async (_: unknown, { limit = 50 }: { limit?: number }) => {
      // Combine fiber transitions, attestations, and contracts into activity feed
      const [fiberTransitions, attestations, contracts] = await Promise.all([
        prisma.fiberTransition.findMany({
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { fiber: true },
        }),
        prisma.attestation.findMany({
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { agent: true, issuer: true },
        }),
        prisma.contract.findMany({
          take: limit,
          orderBy: { proposedAt: 'desc' },
          include: { proposer: true, counterparty: true },
        }),
      ]);

      // Get unique owner addresses from fiber transitions to batch-fetch agents
      const ownerAddresses = [...new Set(
        fiberTransitions
          .filter((t) => t.fiber?.owners?.length)
          .flatMap((t) => t.fiber.owners)
      )];
      
      // Batch fetch agents for fiber owners
      const agents = ownerAddresses.length > 0
        ? await prisma.agent.findMany({
            where: { address: { in: ownerAddresses } },
          })
        : [];
      const agentMap = new Map(agents.map((a) => [a.address, a]));

      const events = [
        ...fiberTransitions.map((t) => {
          // Look up agent from fiber's first owner
          const ownerAddress = t.fiber?.owners?.[0];
          const agent = ownerAddress ? agentMap.get(ownerAddress) ?? null : null;
          return {
            eventType: 'TRANSITION',
            timestamp: t.createdAt,
            agent,
            action: `${t.eventName}: ${t.fromState} → ${t.toState}`,
            reputationDelta: null,
            relatedAgent: null,
            fiberId: t.fiberId,
          };
        }),
        ...attestations.map((a) => ({
          eventType: 'ATTESTATION',
          timestamp: a.createdAt,
          agent: a.agent,
          action: a.type,
          reputationDelta: a.delta,
          relatedAgent: a.issuer,
        })),
        ...contracts.map((c) => ({
          eventType: 'CONTRACT',
          timestamp: c.completedAt ?? c.acceptedAt ?? c.proposedAt,
          agent: c.proposer,
          action: c.state,
          reputationDelta: null,
          relatedAgent: c.counterparty,
        })),
      ];

      return events
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    },

    networkStats: async () => {
      const [
        totalAgents,
        activeAgents,
        totalContracts,
        completedContracts,
        totalAttestations,
        totalFibers,
        lastSnapshot,
      ] = await Promise.all([
        prisma.agent.count(),
        prisma.agent.count({ where: { state: 'ACTIVE' } }),
        prisma.contract.count(),
        prisma.contract.count({ where: { state: 'COMPLETED' } }),
        prisma.attestation.count(),
        prisma.fiber.count(),
        prisma.indexedSnapshot.findFirst({ orderBy: { ordinal: 'desc' } }),
      ]);

      return {
        totalAgents,
        activeAgents,
        totalContracts,
        completedContracts,
        totalAttestations,
        totalFibers,
        lastSnapshotOrdinal: lastSnapshot?.ordinal ? Number(lastSnapshot.ordinal) : 0,
      };
    },

    clusterStats: async () => {
      // Fetch cluster info from metagraph nodes
      const ML0_URL = process.env.METAGRAPH_ML0_URL || 'http://localhost:9200';
      const DL1_URL = process.env.METAGRAPH_DL1_URL || 'http://localhost:9400';
      const GL0_URL = process.env.GL0_URL || 'http://localhost:9100';
      
      const fetchClusterInfo = async (url: string): Promise<number> => {
        try {
          const res = await fetch(`${url}/cluster/info`, { signal: AbortSignal.timeout(2000) });
          if (!res.ok) return 0;
          const data = await res.json();
          return Array.isArray(data) ? data.filter((n: any) => n.state === 'Ready').length : 0;
        } catch {
          return 0;
        }
      };
      
      const fetchOrdinal = async (): Promise<number> => {
        try {
          const res = await fetch(`${ML0_URL}/snapshots/latest/ordinal`, { signal: AbortSignal.timeout(2000) });
          if (!res.ok) return 0;
          const data = await res.json();
          return data?.value ?? 0;
        } catch {
          return 0;
        }
      };

      const [gl0Nodes, ml0Nodes, dl1Nodes, ordinal] = await Promise.all([
        fetchClusterInfo(GL0_URL),
        fetchClusterInfo(ML0_URL),
        fetchClusterInfo(DL1_URL),
        fetchOrdinal(),
      ]);

      // TPS is simulated for now (would need time-series data to calculate real TPS)
      const tps = gl0Nodes > 0 ? Math.random() * 50 + 100 : 0;
      const epoch = Math.floor(ordinal / 100);

      return { gl0Nodes, ml0Nodes, dl1Nodes, tps, epoch };
    },

    statsTrends: async () => {
      // Fetch pre-computed deltas from stats collector
      const [oneHour, twentyFourHour, sevenDay] = await Promise.all([
        prisma.statsDelta.findUnique({ where: { period: '1h' } }),
        prisma.statsDelta.findUnique({ where: { period: '24h' } }),
        prisma.statsDelta.findUnique({ where: { period: '7d' } }),
      ]);

      return {
        oneHour: oneHour ? { ...oneHour, period: '1h' } : null,
        twentyFourHour: twentyFourHour ? { ...twentyFourHour, period: '24h' } : null,
        sevenDay: sevenDay ? { ...sevenDay, period: '7d' } : null,
      };
    },

    searchAgents: async (_: unknown, { query, limit = 10 }: { query: string; limit?: number }) => {
      return prisma.agent.findMany({
        where: {
          OR: [
            { displayName: { contains: query, mode: 'insensitive' } },
            { address: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
      });
    },

    // Unified search across fibers, agents, and transitions
    search: async (_: unknown, { query, limit = 10 }: { query: string; limit?: number }) => {
      const [fibers, agents, transitions] = await Promise.all([
        // Search fibers by ID or workflow type
        prisma.fiber.findMany({
          where: {
            OR: [
              { fiberId: { contains: query, mode: 'insensitive' } },
              { workflowType: { contains: query, mode: 'insensitive' } },
              { currentState: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
        // Search agents by name or address
        prisma.agent.findMany({
          where: {
            OR: [
              { displayName: { contains: query, mode: 'insensitive' } },
              { address: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
        }),
        // Search transitions by event name
        prisma.fiberTransition.findMany({
          where: {
            OR: [
              { eventName: { contains: query, mode: 'insensitive' } },
              { fiberId: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      return { fibers, agents, transitions };
    },

    // === Generic Fiber Queries (chain-agnostic) ===
    
    fiber: async (_: unknown, { fiberId }: { fiberId: string }) => {
      return prisma.fiber.findUnique({ where: { fiberId } });
    },

    fibers: async (
      _: unknown,
      {
        workflowType,
        status,
        owner,
        limit = 20,
        offset = 0,
        orderBy = 'UPDATED_DESC',
      }: {
        workflowType?: string;
        status?: string;
        owner?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
      }
    ) => {
      const orderByMap: Record<string, any> = {
        CREATED_DESC: { createdAt: 'desc' },
        CREATED_ASC: { createdAt: 'asc' },
        UPDATED_DESC: { updatedAt: 'desc' },
        SEQUENCE_DESC: { sequenceNumber: 'desc' },
      };

      return prisma.fiber.findMany({
        where: {
          ...(workflowType && { workflowType }),
          ...(status && { status: status as any }),
          ...(owner && { owners: { has: owner } }),
        },
        orderBy: orderByMap[orderBy] ?? { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      });
    },

    workflowTypes: async () => {
      const fibers = await prisma.fiber.groupBy({
        by: ['workflowType'],
        _count: { fiberId: true },
      });

      // Get sample fiber for each type to extract states
      const types = await Promise.all(
        fibers.map(async (f) => {
          const sample = await prisma.fiber.findFirst({
            where: { workflowType: f.workflowType },
          });
          const definition = sample?.definition as { states?: Record<string, unknown>; metadata?: { description?: string } } | null;
          
          return {
            name: f.workflowType,
            description: definition?.metadata?.description || null,
            count: f._count.fiberId,
            states: definition?.states ? Object.keys(definition.states) : [],
          };
        })
      );

      return types.sort((a, b) => b.count - a.count);
    },

    fibersByOwner: async (_: unknown, { address, limit = 20 }: { address: string; limit?: number }) => {
      return prisma.fiber.findMany({
        where: { owners: { has: address } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
    },
  },

  // === Mutations ===
  Mutation: {
    registerAgent: async (
      _: unknown,
      args: {
        platform: string;
        platformUserId: string;
        platformUsername?: string;
        displayName?: string;
        privateKey?: string;
      },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required for on-chain registration' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.registerAgent({
        privateKey: args.privateKey,
        displayName: args.displayName,
        platform: args.platform,
        platformUserId: args.platformUserId,
      });

      if (!result.success || !result.data) {
        return { success: false, error: result.error };
      }

      // Optionally look up agent from DB after indexer processes it
      // For now return the transaction result
      return {
        success: true,
        txHash: result.data.hash,
        // agent will be available after indexer processes the tx
      };
    },

    vouch: async (
      _: unknown,
      args: {
        fromAddress: string;
        toAddress: string;
        reason?: string;
        signature?: string;
        privateKey?: string;
      },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required for vouching' };
      }

      // Look up target agent's fiberId by address
      const targetAgent = await prisma.agent.findUnique({
        where: { address: args.toAddress },
      });
      
      if (!targetAgent?.fiberId) {
        return { success: false, error: 'Target agent not found or has no fiberId' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.vouch({
        privateKey: args.privateKey,
        targetFiberId: targetAgent.fiberId,
        fromAddress: args.fromAddress,
        reason: args.reason,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, txHash: result.data?.hash };
    },

    proposeContract: async (
      _: unknown,
      args: {
        proposerAddress: string;
        counterpartyAddress: string;
        terms: Record<string, unknown>;
        signature?: string;
        privateKey?: string;
      },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required for proposing contract' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.proposeContract({
        privateKey: args.privateKey,
        counterpartyAddress: args.counterpartyAddress,
        terms: args.terms,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, txHash: result.data?.hash };
    },

    acceptContract: async (
      _: unknown,
      args: { contractId: string; privateKey?: string },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.acceptContract({
        privateKey: args.privateKey,
        contractId: args.contractId,
      });

      return result.success
        ? { success: true, txHash: result.data?.hash }
        : { success: false, error: result.error };
    },

    rejectContract: async (
      _: unknown,
      args: { contractId: string; reason?: string; privateKey?: string },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.rejectContract({
        privateKey: args.privateKey,
        contractId: args.contractId,
        reason: args.reason,
      });

      return result.success
        ? { success: true, txHash: result.data?.hash }
        : { success: false, error: result.error };
    },

    completeContract: async (
      _: unknown,
      args: { contractId: string; proof?: string; privateKey?: string },
      _ctx: Context
    ) => {
      if (!args.privateKey) {
        return { success: false, error: 'privateKey required' };
      }

      const bridge = getBridgeClient();
      const result = await bridge.completeContract({
        privateKey: args.privateKey,
        contractId: args.contractId,
        proof: args.proof,
      });

      return result.success
        ? { success: true, txHash: result.data?.hash }
        : { success: false, error: result.error };
    },

    linkPlatform: async (_: unknown, _args: unknown, _ctx: Context) => {
      // Platform linking requires updating agent state - implement when needed
      return { success: false, error: 'Platform linking not yet implemented' };
    },
  },

  // === Field Resolvers ===
  Agent: {
    platformLinks: async (parent: { id: number }) => {
      return prisma.platformLink.findMany({ where: { agentId: parent.id } });
    },

    attestationsReceived: async (
      parent: { id: number },
      { limit = 20, offset = 0 }: { limit?: number; offset?: number }
    ) => {
      return prisma.attestation.findMany({
        where: { agentId: parent.id },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      });
    },

    contractsAsProposer: async (parent: { id: number }, { state }: { state?: string }) => {
      return prisma.contract.findMany({
        where: {
          proposerId: parent.id,
          ...(state && { state: state as any }),
        },
      });
    },

    contractsAsCounterparty: async (parent: { id: number }, { state }: { state?: string }) => {
      return prisma.contract.findMany({
        where: {
          counterpartyId: parent.id,
          ...(state && { state: state as any }),
        },
      });
    },

    reputationHistory: async (parent: { id: number }, { limit = 50 }: { limit?: number }) => {
      return prisma.reputationHistory.findMany({
        where: { agentId: parent.id },
        take: limit,
        orderBy: { recordedAt: 'asc' },
      });
    },
  },

  Attestation: {
    issuer: async (parent: { issuerId: number | null }) => {
      if (!parent.issuerId) return null;
      return prisma.agent.findUnique({ where: { id: parent.issuerId } });
    },
  },

  Contract: {
    proposer: async (parent: { proposerId: number }) => {
      return prisma.agent.findUnique({ where: { id: parent.proposerId } });
    },
    counterparty: async (parent: { counterpartyId: number }) => {
      return prisma.agent.findUnique({ where: { id: parent.counterpartyId } });
    },
  },

  Fiber: {
    transitions: async (parent: { fiberId: string }, { limit = 20 }: { limit?: number }) => {
      return prisma.fiberTransition.findMany({
        where: { fiberId: parent.fiberId },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
    },
  },

  // === Subscriptions ===
  Subscription: {
    agentUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.AGENT_UPDATED),
      resolve: (payload: any) => payload,
    },
    newAttestation: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.ACTIVITY_FEED),
      resolve: (payload: any) => payload,
    },
    contractUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.CONTRACT_UPDATED),
      resolve: (payload: any) => payload,
    },
    activityFeed: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.ACTIVITY_FEED),
      resolve: (payload: any) => payload,
    },
    statsUpdated: {
      subscribe: () => pubsub.asyncIterableIterator(CHANNELS.STATS_UPDATED),
      resolve: (payload: any) => payload,
    },
  },
};

// Export pubsub for use by indexer webhook handler
export { pubsub };
