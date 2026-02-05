// GraphQL Resolvers

import { prisma } from '@ottochain/shared';
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
      // Combine attestations and contracts into activity feed
      const [attestations, contracts] = await Promise.all([
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

      const events = [
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
      },
      ctx: Context
    ) => {
      // TODO: Call Bridge to register on-chain
      // For now, return placeholder
      return {
        success: false,
        error: 'Bridge integration pending',
      };
    },

    vouch: async (
      _: unknown,
      args: {
        fromAddress: string;
        toAddress: string;
        reason?: string;
        signature: string;
      },
      ctx: Context
    ) => {
      // TODO: Verify signature, call Bridge
      return {
        success: false,
        error: 'Bridge integration pending',
      };
    },

    proposeContract: async (_: unknown, args: any, ctx: Context) => {
      return { success: false, error: 'Bridge integration pending' };
    },

    acceptContract: async (_: unknown, args: any, ctx: Context) => {
      return { success: false, error: 'Bridge integration pending' };
    },

    rejectContract: async (_: unknown, args: any, ctx: Context) => {
      return { success: false, error: 'Bridge integration pending' };
    },

    completeContract: async (_: unknown, args: any, ctx: Context) => {
      return { success: false, error: 'Bridge integration pending' };
    },

    linkPlatform: async (_: unknown, args: any, ctx: Context) => {
      return { success: false, error: 'Bridge integration pending' };
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
