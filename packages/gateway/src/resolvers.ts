// GraphQL Resolvers

import { GraphQLScalarType, Kind } from 'graphql';
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
  MARKET_UPDATED: 'MARKET_UPDATED',
} as const;

// BigInt scalar for ordinal numbers
const BigIntScalar = new GraphQLScalarType({
  name: 'BigInt',
  description: 'BigInt custom scalar type',
  serialize(value: unknown): string {
    return String(value);
  },
  parseValue(value: unknown): bigint {
    return BigInt(value as string | number);
  },
  parseLiteral(ast): bigint | null {
    if (ast.kind === Kind.INT || ast.kind === Kind.STRING) {
      return BigInt(ast.value);
    }
    return null;
  },
});

export const resolvers = {
  BigInt: BigIntScalar,
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
      // Show top agents by reputation regardless of state (useful for testnet)
      return prisma.agent.findMany({
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
          const data = await res.json() as { value?: number };
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

    recentSnapshots: async (_: unknown, { limit = 20 }: { limit?: number }) => {
      return prisma.indexedSnapshot.findMany({
        orderBy: { ordinal: 'desc' },
        take: limit,
      });
    },

    snapshot: async (_: unknown, { ordinal }: { ordinal: bigint }) => {
      return prisma.indexedSnapshot.findUnique({
        where: { ordinal },
      });
    },

    // === Market Queries ===

    market: async (_: unknown, { marketId }: { marketId: string }) => {
      return prisma.fiber.findFirst({
        where: { fiberId: marketId, workflowType: 'Market' },
      });
    },

    marketsByType: async (
      _: unknown,
      {
        marketType,
        marketStatus,
        creator,
        oracle,
        limit = 20,
        offset = 0,
        orderBy = 'CREATED_DESC',
      }: {
        marketType?: string;
        marketStatus?: string;
        creator?: string;
        oracle?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
      }
    ) => {
      // Map GraphQL enum → stateData JSON values
      const typeMap: Record<string, string> = {
        PREDICTION: 'prediction',
        AUCTION: 'auction',
        CROWDFUND: 'crowdfund',
        GROUP_BUY: 'group_buy',
      };

      const orderByMap: Record<string, any> = {
        CREATED_DESC: { createdAt: 'desc' },
        CREATED_ASC: { createdAt: 'asc' },
        UPDATED_DESC: { updatedAt: 'desc' },
        TOTAL_COMMITTED_DESC: { updatedAt: 'desc' }, // fallback; totalCommitted is in JSON
      };

      // Build JSON path filters for stateData fields
      const jsonFilters: any[] = [];
      if (marketType) {
        jsonFilters.push({
          stateData: { path: ['marketType'], equals: typeMap[marketType] ?? marketType.toLowerCase() },
        });
      }
      if (marketStatus) {
        jsonFilters.push({
          stateData: { path: ['status'], equals: marketStatus },
        });
      }
      if (creator) {
        jsonFilters.push({
          stateData: { path: ['creator'], equals: creator },
        });
      }

      const fibers = await prisma.fiber.findMany({
        where: {
          workflowType: 'Market',
          AND: jsonFilters.length > 0 ? jsonFilters : undefined,
        },
        orderBy: orderByMap[orderBy] ?? { createdAt: 'desc' },
        take: oracle ? limit + 100 : limit, // over-fetch if filtering by oracle (post-filter)
        skip: oracle ? 0 : offset,
      });

      // Post-filter by oracle (oracle is inside stateData.oracles array — hard to query via Prisma JSON)
      if (oracle) {
        const filtered = fibers.filter((f) => {
          const sd = f.stateData as Record<string, unknown>;
          const oracles = sd?.oracles as string[] | undefined;
          return Array.isArray(oracles) && oracles.includes(oracle);
        });
        return filtered.slice(offset, offset + limit);
      }

      return fibers;
    },

    marketStats: async () => {
      const allMarkets = await prisma.fiber.findMany({
        where: { workflowType: 'Market' },
        select: { stateData: true },
      });

      const byType = { prediction: 0, auction: 0, crowdfund: 0, groupBuy: 0 };
      const byStatus = { proposed: 0, open: 0, closed: 0, resolving: 0, settled: 0, refunded: 0, cancelled: 0 };
      let totalCommitted = 0;
      const oracleSet = new Set<string>();

      for (const { stateData } of allMarkets) {
        const sd = stateData as Record<string, unknown>;
        
        // Count by type
        const mt = (sd?.marketType as string | undefined)?.toLowerCase();
        if (mt === 'prediction') byType.prediction++;
        else if (mt === 'auction') byType.auction++;
        else if (mt === 'crowdfund') byType.crowdfund++;
        else if (mt === 'group_buy') byType.groupBuy++;

        // Count by status
        const st = (sd?.status as string | undefined)?.toUpperCase();
        if (st === 'PROPOSED') byStatus.proposed++;
        else if (st === 'OPEN') byStatus.open++;
        else if (st === 'CLOSED') byStatus.closed++;
        else if (st === 'RESOLVING') byStatus.resolving++;
        else if (st === 'SETTLED') byStatus.settled++;
        else if (st === 'REFUNDED') byStatus.refunded++;
        else if (st === 'CANCELLED') byStatus.cancelled++;

        // Sum totalCommitted
        const committed = sd?.totalCommitted;
        if (typeof committed === 'number') totalCommitted += committed;

        // Collect oracle addresses
        const oracles = sd?.oracles as string[] | undefined;
        if (Array.isArray(oracles)) {
          oracles.forEach((o) => oracleSet.add(o));
        }
      }

      return {
        totalMarkets: allMarkets.length,
        byType,
        byStatus,
        totalCommitted,
        activeOracles: oracleSet.size,
      };
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

  // === Market Field Resolvers ===
  // Markets are stored as Fiber rows; these extract typed fields from stateData JSON.

  Market: {
    transitions: async (parent: { fiberId: string }, { limit = 20 }: { limit?: number }) => {
      return prisma.fiberTransition.findMany({
        where: { fiberId: parent.fiberId },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
    },

    marketType: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      const raw = (sd?.marketType as string | undefined)?.toLowerCase();
      const typeMap: Record<string, string> = {
        prediction: 'PREDICTION',
        auction: 'AUCTION',
        crowdfund: 'CROWDFUND',
        group_buy: 'GROUP_BUY',
      };
      return typeMap[raw ?? ''] ?? 'PREDICTION';
    },

    marketStatus: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      const raw = (sd?.status as string | undefined)?.toUpperCase();
      const validStatuses = ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'];
      return validStatuses.includes(raw ?? '') ? raw : 'PROPOSED';
    },

    creator: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return (sd?.creator as string | undefined) ?? '';
    },

    title: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return (sd?.title as string | undefined) ?? 'Untitled Market';
    },

    description: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return (sd?.description as string | null | undefined) ?? null;
    },

    terms: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return (sd?.terms ?? null) as unknown;
    },

    deadline: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return typeof sd?.deadline === 'number' ? sd.deadline : null;
    },

    threshold: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return typeof sd?.threshold === 'number' ? sd.threshold : null;
    },

    oracles: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      const oracles = sd?.oracles;
      return Array.isArray(oracles) ? oracles : [];
    },

    quorum: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return typeof sd?.quorum === 'number' ? sd.quorum : 1;
    },

    commitments: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      const raw = sd?.commitments;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      // commitments is { [address]: amount } or { [address]: { amount, outcome } }
      return Object.entries(raw as Record<string, unknown>).map(([address, value]) => {
        if (typeof value === 'number') {
          return { address, amount: value, outcome: null };
        }
        const v = value as Record<string, unknown>;
        return {
          address,
          amount: typeof v?.amount === 'number' ? v.amount : 0,
          outcome: (v?.outcome as string | null | undefined) ?? null,
        };
      });
    },

    totalCommitted: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return typeof sd?.totalCommitted === 'number' ? sd.totalCommitted : 0;
    },

    resolutions: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      const raw = sd?.resolutions;
      if (!Array.isArray(raw)) return [];
      return (raw as Record<string, unknown>[]).map((r) => ({
        outcome: (r?.outcome as string | undefined) ?? '',
        resolvedBy: (r?.resolvedBy as string | undefined) ?? '',
        resolvedAt: (r?.resolvedAt as string | null | undefined) ?? null,
      }));
    },

    claims: (parent: { stateData: unknown }) => {
      const sd = parent.stateData as Record<string, unknown>;
      return (sd?.claims ?? null) as unknown;
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
    marketUpdated: {
      subscribe: (_: unknown, { marketId }: { marketId?: string }) => {
        const channel = marketId
          ? `${CHANNELS.MARKET_UPDATED}:${marketId}`
          : CHANNELS.MARKET_UPDATED;
        return pubsub.asyncIterableIterator(channel);
      },
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
