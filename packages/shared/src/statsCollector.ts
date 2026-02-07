/**
 * Stats Collector - Time-series stats collection with automatic aggregation and pruning
 * 
 * Scalability considerations:
 * - Uses time buckets to limit storage growth
 * - Background async writes (doesn't block main operations)
 * - Pre-computes deltas for fast reads
 * - Automatic tiered retention (5-min → hourly → daily)
 */

import { PrismaClient, StatsGranularity } from '@prisma/client';

// Retention policies
const RETENTION = {
  FIVE_MIN: 24 * 60 * 60 * 1000,  // 24 hours in ms
  HOURLY: 7 * 24 * 60 * 60 * 1000, // 7 days
  DAILY: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Bucket intervals in ms
const BUCKET_INTERVAL = {
  FIVE_MIN: 5 * 60 * 1000,
  HOURLY: 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
};

/**
 * Round timestamp to bucket boundary
 */
function toBucket(date: Date, granularity: StatsGranularity): Date {
  const ms = date.getTime();
  const interval = BUCKET_INTERVAL[granularity];
  return new Date(Math.floor(ms / interval) * interval);
}

export interface StatsCollectorOptions {
  prisma: PrismaClient;
  collectIntervalMs?: number;  // How often to collect (default: 5 min)
  aggregateIntervalMs?: number; // How often to aggregate (default: 15 min)
}

export class StatsCollector {
  private prisma: PrismaClient;
  private collectInterval: NodeJS.Timeout | null = null;
  private aggregateInterval: NodeJS.Timeout | null = null;
  private isCollecting = false;

  constructor(private options: StatsCollectorOptions) {
    this.prisma = options.prisma;
  }

  /**
   * Start the background collection and aggregation
   */
  start() {
    const collectMs = this.options.collectIntervalMs ?? 5 * 60 * 1000; // 5 min
    const aggregateMs = this.options.aggregateIntervalMs ?? 15 * 60 * 1000; // 15 min

    // Collect immediately, then on interval
    this.collect().catch(console.error);
    this.collectInterval = setInterval(() => {
      this.collect().catch(console.error);
    }, collectMs);

    // Aggregate/prune on interval (with initial delay)
    setTimeout(() => {
      this.aggregateAndPrune().catch(console.error);
      this.aggregateInterval = setInterval(() => {
        this.aggregateAndPrune().catch(console.error);
      }, aggregateMs);
    }, 60 * 1000); // Start aggregation after 1 min

    console.log(`📊 Stats collector started (collect: ${collectMs/1000}s, aggregate: ${aggregateMs/1000}s)`);
  }

  /**
   * Stop the background collection
   */
  stop() {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
    if (this.aggregateInterval) {
      clearInterval(this.aggregateInterval);
      this.aggregateInterval = null;
    }
    console.log('📊 Stats collector stopped');
  }

  /**
   * Collect current stats and store in 5-min bucket
   */
  async collect(): Promise<void> {
    if (this.isCollecting) return; // Prevent overlapping collections
    this.isCollecting = true;

    try {
      const now = new Date();
      const bucketTime = toBucket(now, 'FIVE_MIN');

      // Gather current stats
      const [
        totalAgents,
        activeAgents,
        totalContracts,
        completedContracts,
        totalAttestations,
        totalFibers,
        lastSnapshot,
      ] = await Promise.all([
        this.prisma.agent.count(),
        this.prisma.agent.count({ where: { state: 'ACTIVE' } }),
        this.prisma.contract.count(),
        this.prisma.contract.count({ where: { state: 'COMPLETED' } }),
        this.prisma.attestation.count(),
        this.prisma.fiber.count(),
        this.prisma.indexedSnapshot.findFirst({ orderBy: { ordinal: 'desc' } }),
      ]);

      // Upsert into bucket (increment snapshotsInPeriod if bucket exists)
      await this.prisma.statsSnapshot.upsert({
        where: {
          bucketTime_granularity: {
            bucketTime,
            granularity: 'FIVE_MIN',
          },
        },
        create: {
          bucketTime,
          granularity: 'FIVE_MIN',
          totalAgents,
          activeAgents,
          totalContracts,
          completedContracts,
          totalAttestations,
          totalFibers,
          snapshotOrdinal: lastSnapshot?.ordinal ?? BigInt(0),
          snapshotsInPeriod: 1,
        },
        update: {
          totalAgents,
          activeAgents,
          totalContracts,
          completedContracts,
          totalAttestations,
          totalFibers,
          snapshotOrdinal: lastSnapshot?.ordinal ?? BigInt(0),
          snapshotsInPeriod: { increment: 1 },
        },
      });

      // Update pre-computed deltas
      await this.computeDeltas();

    } catch (error) {
      console.error('Stats collection error:', error);
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Compute trend deltas for common periods
   */
  async computeDeltas(): Promise<void> {
    const now = new Date();

    for (const period of ['1h', '24h', '7d'] as const) {
      try {
        const msAgo = period === '1h' ? 60 * 60 * 1000 
                    : period === '24h' ? 24 * 60 * 60 * 1000 
                    : 7 * 24 * 60 * 60 * 1000;
        
        const cutoff = new Date(now.getTime() - msAgo);

        // Get current stats (latest bucket)
        const current = await this.prisma.statsSnapshot.findFirst({
          where: { granularity: 'FIVE_MIN' },
          orderBy: { bucketTime: 'desc' },
        });

        // Get historical stats (closest to cutoff time)
        const historical = await this.prisma.statsSnapshot.findFirst({
          where: {
            bucketTime: { lte: cutoff },
            granularity: period === '7d' ? 'DAILY' : period === '24h' ? 'HOURLY' : 'FIVE_MIN',
          },
          orderBy: { bucketTime: 'desc' },
        });

        if (!current || !historical) continue;

        // Calculate deltas
        const agentsDelta = current.totalAgents - historical.totalAgents;
        const contractsDelta = current.totalContracts - historical.totalContracts;
        const attestationsDelta = current.totalAttestations - historical.totalAttestations;
        const fibersDelta = current.totalFibers - historical.totalFibers;

        // Percentage changes (avoid division by zero)
        const agentsPct = historical.totalAgents > 0 
          ? ((current.totalAgents - historical.totalAgents) / historical.totalAgents) * 100 
          : 0;
        const contractsPct = historical.totalContracts > 0
          ? ((current.totalContracts - historical.totalContracts) / historical.totalContracts) * 100
          : 0;

        // Success rate change
        const currentSuccessRate = current.totalContracts > 0 
          ? (current.completedContracts / current.totalContracts) * 100 : 0;
        const historicalSuccessRate = historical.totalContracts > 0 
          ? (historical.completedContracts / historical.totalContracts) * 100 : 0;
        const successRatePct = currentSuccessRate - historicalSuccessRate;

        // Average snapshots per hour (throughput proxy)
        const snapshots = await this.prisma.statsSnapshot.aggregate({
          where: {
            bucketTime: { gte: cutoff },
            granularity: 'FIVE_MIN',
          },
          _sum: { snapshotsInPeriod: true },
          _count: true,
        });
        const hours = msAgo / (60 * 60 * 1000);
        const avgSnapshotsPerHour = (snapshots._sum.snapshotsInPeriod ?? 0) / hours;

        // Upsert delta record
        await this.prisma.statsDelta.upsert({
          where: { period },
          create: {
            period,
            agentsDelta,
            contractsDelta,
            attestationsDelta,
            fibersDelta,
            agentsPct,
            contractsPct,
            successRatePct,
            avgSnapshotsPerHour,
          },
          update: {
            agentsDelta,
            contractsDelta,
            attestationsDelta,
            fibersDelta,
            agentsPct,
            contractsPct,
            successRatePct,
            avgSnapshotsPerHour,
            computedAt: new Date(),
          },
        });
      } catch (error) {
        console.error(`Error computing ${period} deltas:`, error);
      }
    }
  }

  /**
   * Aggregate old 5-min data into hourly, and old hourly into daily
   * Also prune data beyond retention limits
   */
  async aggregateAndPrune(): Promise<void> {
    const now = new Date();

    try {
      // 1. Aggregate 5-min buckets older than 24h into hourly
      const hourlyThreshold = new Date(now.getTime() - RETENTION.FIVE_MIN);
      await this.aggregateBuckets('FIVE_MIN', 'HOURLY', hourlyThreshold);

      // 2. Aggregate hourly buckets older than 7d into daily
      const dailyThreshold = new Date(now.getTime() - RETENTION.HOURLY);
      await this.aggregateBuckets('HOURLY', 'DAILY', dailyThreshold);

      // 3. Prune daily buckets older than 30d
      const pruneThreshold = new Date(now.getTime() - RETENTION.DAILY);
      const pruned = await this.prisma.statsSnapshot.deleteMany({
        where: {
          bucketTime: { lt: pruneThreshold },
          granularity: 'DAILY',
        },
      });

      if (pruned.count > 0) {
        console.log(`📊 Pruned ${pruned.count} old daily stats`);
      }

    } catch (error) {
      console.error('Aggregation/pruning error:', error);
    }
  }

  /**
   * Aggregate fine-grained buckets into coarser ones
   */
  private async aggregateBuckets(
    fromGranularity: StatsGranularity,
    toGranularity: StatsGranularity,
    olderThan: Date
  ): Promise<void> {
    // Find old buckets to aggregate
    const oldBuckets = await this.prisma.statsSnapshot.findMany({
      where: {
        bucketTime: { lt: olderThan },
        granularity: fromGranularity,
      },
      orderBy: { bucketTime: 'asc' },
    });

    if (oldBuckets.length === 0) return;

    // Group by target bucket
    const groups = new Map<string, typeof oldBuckets>();
    for (const bucket of oldBuckets) {
      const targetBucket = toBucket(bucket.bucketTime, toGranularity);
      const key = targetBucket.toISOString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(bucket);
    }

    // Create aggregated buckets
    for (const [bucketKey, buckets] of groups) {
      const bucketTime = new Date(bucketKey);
      
      // Take the latest values (most accurate for point-in-time metrics)
      const latest = buckets[buckets.length - 1];
      const totalSnapshotsInPeriod = buckets.reduce((sum, b) => sum + b.snapshotsInPeriod, 0);

      await this.prisma.statsSnapshot.upsert({
        where: {
          bucketTime_granularity: { bucketTime, granularity: toGranularity },
        },
        create: {
          bucketTime,
          granularity: toGranularity,
          totalAgents: latest.totalAgents,
          activeAgents: latest.activeAgents,
          totalContracts: latest.totalContracts,
          completedContracts: latest.completedContracts,
          totalAttestations: latest.totalAttestations,
          totalFibers: latest.totalFibers,
          snapshotOrdinal: latest.snapshotOrdinal,
          snapshotsInPeriod: totalSnapshotsInPeriod,
        },
        update: {
          totalAgents: latest.totalAgents,
          activeAgents: latest.activeAgents,
          totalContracts: latest.totalContracts,
          completedContracts: latest.completedContracts,
          totalAttestations: latest.totalAttestations,
          totalFibers: latest.totalFibers,
          snapshotOrdinal: latest.snapshotOrdinal,
          snapshotsInPeriod: totalSnapshotsInPeriod,
        },
      });
    }

    // Delete the aggregated fine-grained buckets
    const deleted = await this.prisma.statsSnapshot.deleteMany({
      where: {
        bucketTime: { lt: olderThan },
        granularity: fromGranularity,
      },
    });

    console.log(`📊 Aggregated ${deleted.count} ${fromGranularity} buckets into ${toGranularity}`);
  }

  /**
   * Get pre-computed deltas (fast read from cache table)
   */
  async getDeltas(period: '1h' | '24h' | '7d') {
    return this.prisma.statsDelta.findUnique({
      where: { period },
    });
  }

  /**
   * Get all deltas at once
   */
  async getAllDeltas() {
    const deltas = await this.prisma.statsDelta.findMany();
    return Object.fromEntries(deltas.map(d => [d.period, d]));
  }
}

// Singleton instance
let collector: StatsCollector | null = null;

export function getStatsCollector(
  prisma: PrismaClient, 
  options?: Partial<Omit<StatsCollectorOptions, 'prisma'>>
): StatsCollector {
  if (!collector) {
    collector = new StatsCollector({ prisma, ...options });
  }
  return collector;
}
