// OttoChain Indexer
// Receives snapshot notifications from ML0 via webhook push, indexes state to Postgres
// Confirms snapshots against GL0 global snapshots
// Low-frequency fallback poller catches missed webhooks + detects forks across peers

import express, { Request, Response } from 'express';
import { prisma, getConfig, SnapshotNotificationSchema, RejectionNotificationSchema, getStatsCollector } from '@ottochain/shared';
import { processSnapshot } from './processor.js';
import { startConfirmationPoller, stopConfirmationPoller, getConfirmationStats } from './confirmations.js';
import { startSnapshotPoller, stopSnapshotPoller, getPollerStats } from './poller.js';

// Stats collector - initialized in server.listen with config
let statsCollector: ReturnType<typeof getStatsCollector> | null = null;

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'indexer' });
});

// Version info
app.get('/version', (_, res) => {
  res.json({
    service: 'indexer',
    version: process.env.npm_package_version ?? '0.1.0',
    commit: process.env.GIT_SHA ?? 'unknown',
    built: process.env.BUILD_TIME ?? 'unknown',
    node: process.version,
  });
});

// Webhook endpoint for ML0 notifications (snapshots and rejections)
// ML0 WebhookDispatcher sends both event types to the registered callback URL,
// so we route based on the 'event' field in the payload.
app.post('/webhook/snapshot', async (req, res) => {
  try {
    const event = req.body?.event;
    
    // Route rejection events to the rejection handler
    if (event === 'transaction.rejected') {
      return handleRejectionWebhook(req, res);
    }
    
    // Validate incoming payload as snapshot notification
    const notification = SnapshotNotificationSchema.parse(req.body);
    
    console.log(`📥 Received snapshot notification: ordinal=${notification.ordinal}, hash=${notification.hash}`);
    
    // Check if already indexed
    const existing = await prisma.indexedSnapshot.findUnique({
      where: { ordinal: BigInt(notification.ordinal) }
    });
    
    if (existing) {
      console.log(`⏭️ Snapshot ${notification.ordinal} already indexed (status: ${existing.status})`);
      res.status(200).json({ 
        accepted: true, 
        ordinal: notification.ordinal,
        status: existing.status,
        alreadyIndexed: true
      });
      return;
    }
    
    // Create PENDING record first
    await prisma.indexedSnapshot.create({
      data: {
        ordinal: BigInt(notification.ordinal),
        hash: notification.hash,
        status: 'PENDING',
      }
    });
    
    console.log(`📝 Created PENDING snapshot ${notification.ordinal}`);
    
    // Process the snapshot asynchronously (index the state)
    processSnapshot(notification)
      .then((result) => {
        console.log(`✅ Indexed snapshot ${notification.ordinal}: ${result.fibersUpdated} fibers, ${result.agentsUpdated} agents, ${result.contractsUpdated} contracts`);
      })
      .catch((err) => {
        console.error(`❌ Failed to index snapshot ${notification.ordinal}:`, err);
      });
    
    // Return immediately (async processing)
    res.status(202).json({ 
      accepted: true, 
      ordinal: notification.ordinal,
      status: 'PENDING'
    });
  } catch (err) {
    console.error('Invalid webhook payload:', err);
    res.status(400).json({ error: 'Invalid payload' });
  }
});

// Shared rejection handler - used by both /webhook/snapshot (routed) and /webhook/rejection (direct)
async function handleRejectionWebhook(req: Request, res: Response): Promise<void> {
  try {
    // Validate incoming payload
    const notification = RejectionNotificationSchema.parse(req.body);
    const { rejection } = notification;
    
    console.log(`📥 Received rejection notification: ordinal=${notification.ordinal}, type=${rejection.updateType}, fiberId=${rejection.fiberId}`);
    
    // Check if already stored (dedup by updateHash)
    const existing = await prisma.rejectedTransaction.findUnique({
      where: { updateHash: rejection.updateHash }
    });
    
    if (existing) {
      console.log(`⏭️ Rejection ${rejection.updateHash.substring(0, 16)}... already indexed`);
      res.status(200).json({ 
        accepted: true,
        alreadyIndexed: true,
        updateHash: rejection.updateHash
      });
      return;
    }
    
    // Store the rejection
    await prisma.rejectedTransaction.create({
      data: {
        ordinal: BigInt(notification.ordinal),
        timestamp: new Date(notification.timestamp),
        updateType: rejection.updateType,
        fiberId: rejection.fiberId,
        updateHash: rejection.updateHash,
        errors: rejection.errors,
        signers: rejection.signers,
        rawPayload: req.body,
      }
    });
    
    console.log(`📝 Stored rejection: type=${rejection.updateType}, fiberId=${rejection.fiberId.substring(0, 8)}..., errors=[${rejection.errors.map(e => e.code).join(', ')}]`);
    
    res.status(201).json({ 
      accepted: true,
      updateHash: rejection.updateHash
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      // Race condition - already stored
      console.log(`⏭️ Rejection already indexed (race condition)`);
      res.status(200).json({ accepted: true, alreadyIndexed: true });
      return;
    }
    console.error('Invalid rejection webhook payload:', err);
    res.status(400).json({ error: 'Invalid payload' });
  }
}

// Webhook endpoint for ML0 rejection notifications (direct access)
// Note: ML0 typically sends rejections to the same URL as snapshots,
// but this endpoint is kept for direct access and testing.
app.post('/webhook/rejection', handleRejectionWebhook);

// Get indexer status with confirmation stats
app.get('/status', async (_, res) => {
  const lastSnapshot = await prisma.indexedSnapshot.findFirst({
    orderBy: { ordinal: 'desc' },
  });
  
  const lastConfirmed = await prisma.indexedSnapshot.findFirst({
    where: { status: 'CONFIRMED' },
    orderBy: { ordinal: 'desc' },
  });
  
  const confirmationStats = await getConfirmationStats();
  const pollerStats = getPollerStats();
  
  const stats = {
    lastIndexedOrdinal: lastSnapshot?.ordinal ? Number(lastSnapshot.ordinal) : null,
    lastIndexedAt: lastSnapshot?.indexedAt ?? null,
    lastIndexedStatus: lastSnapshot?.status ?? null,
    lastConfirmedOrdinal: lastConfirmed?.ordinal ? Number(lastConfirmed.ordinal) : null,
    lastConfirmedAt: lastConfirmed?.confirmedAt ?? null,
    confirmations: confirmationStats,
    poller: pollerStats,
    webhookSubscription: webhookSubscriptionId,
    totalAgents: await prisma.agent.count(),
    totalContracts: await prisma.contract.count(),
    totalFibers: await prisma.fiber.count(),
    totalRejections: await prisma.rejectedTransaction.count(),
  };
  
  res.json(stats);
});

// Get snapshots with optional status filter
app.get('/snapshots', async (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  
  const where = status ? { status: status as any } : {};
  
  const snapshots = await prisma.indexedSnapshot.findMany({
    where,
    orderBy: { ordinal: 'desc' },
    take: limit,
  });
  
  res.json({
    snapshots: snapshots.map(s => ({
      ordinal: Number(s.ordinal),
      hash: s.hash,
      status: s.status,
      gl0Ordinal: s.gl0Ordinal ? Number(s.gl0Ordinal) : null,
      confirmedAt: s.confirmedAt,
      indexedAt: s.indexedAt,
      fibersUpdated: s.fibersUpdated,
      agentsUpdated: s.agentsUpdated,
      contractsUpdated: s.contractsUpdated,
    })),
    total: await prisma.indexedSnapshot.count({ where }),
  });
});

// Get rejected transactions with optional filters
app.get('/rejections', async (req, res) => {
  const fiberId = req.query.fiberId as string | undefined;
  const updateType = req.query.updateType as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  
  const where: any = {};
  if (fiberId) where.fiberId = fiberId;
  if (updateType) where.updateType = updateType;
  
  const [rejections, total] = await Promise.all([
    prisma.rejectedTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.rejectedTransaction.count({ where }),
  ]);
  
  res.json({
    rejections: rejections.map(r => ({
      id: r.id,
      ordinal: Number(r.ordinal),
      timestamp: r.timestamp,
      updateType: r.updateType,
      fiberId: r.fiberId,
      updateHash: r.updateHash,
      errors: r.errors,
      signers: r.signers,
      createdAt: r.createdAt,
    })),
    total,
    hasMore: offset + rejections.length < total,
  });
});

// Get rejection by updateHash
app.get('/rejections/:updateHash', async (req, res) => {
  const rejection = await prisma.rejectedTransaction.findUnique({
    where: { updateHash: req.params.updateHash }
  });
  
  if (!rejection) {
    res.status(404).json({ error: 'Rejection not found' });
    return;
  }
  
  res.json({
    id: rejection.id,
    ordinal: Number(rejection.ordinal),
    timestamp: rejection.timestamp,
    updateType: rejection.updateType,
    fiberId: rejection.fiberId,
    updateHash: rejection.updateHash,
    errors: rejection.errors,
    signers: rejection.signers,
    rawPayload: rejection.rawPayload,
    createdAt: rejection.createdAt,
  });
});

// Get a specific fiber by ID
app.get('/fibers/:fiberId', async (req, res) => {
  const fiber = await prisma.fiber.findUnique({
    where: { fiberId: req.params.fiberId }
  });
  
  if (!fiber) {
    res.status(404).json({ error: 'Fiber not found' });
    return;
  }
  
  res.json({
    fiberId: fiber.fiberId,
    workflowType: fiber.workflowType,
    workflowDesc: fiber.workflowDesc,
    currentState: fiber.currentState,
    status: fiber.status,
    owners: fiber.owners,
    stateData: fiber.stateData,
    sequenceNumber: fiber.sequenceNumber,
    createdOrdinal: Number(fiber.createdOrdinal),
    updatedOrdinal: Number(fiber.updatedOrdinal),
    createdGl0Ordinal: fiber.createdGl0Ordinal ? Number(fiber.createdGl0Ordinal) : null,
    updatedGl0Ordinal: fiber.updatedGl0Ordinal ? Number(fiber.updatedGl0Ordinal) : null,
    createdAt: fiber.createdAt,
    updatedAt: fiber.updatedAt,
  });
});

// Get transitions for a specific fiber
app.get('/fibers/:fiberId/transitions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  
  const [transitions, total] = await Promise.all([
    prisma.fiberTransition.findMany({
      where: { fiberId: req.params.fiberId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.fiberTransition.count({ 
      where: { fiberId: req.params.fiberId } 
    }),
  ]);
  
  res.json({
    transitions: transitions.map(t => ({
      id: t.id,
      fiberId: t.fiberId,
      eventName: t.eventName,
      fromState: t.fromState,
      toState: t.toState,
      success: t.success,
      gasUsed: t.gasUsed,
      payload: t.payload,
      snapshotOrdinal: Number(t.snapshotOrdinal),
      gl0Ordinal: t.gl0Ordinal ? Number(t.gl0Ordinal) : null,
      createdAt: t.createdAt,
    })),
    total,
    hasMore: offset + transitions.length < total,
  });
});

// Get rejections for a specific fiber
app.get('/fibers/:fiberId/rejections', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  const [rejections, total] = await Promise.all([
    prisma.rejectedTransaction.findMany({
      where: { fiberId: req.params.fiberId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.rejectedTransaction.count({ 
      where: { fiberId: req.params.fiberId } 
    }),
  ]);
  
  res.json({
    rejections: rejections.map(r => ({
      id: r.id,
      ordinal: Number(r.ordinal),
      timestamp: r.timestamp,
      updateType: r.updateType,
      fiberId: r.fiberId,
      updateHash: r.updateHash,
      errors: r.errors,
      signers: r.signers,
      createdAt: r.createdAt,
    })),
    total,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  stopSnapshotPoller();
  stopConfirmationPoller();
  statsCollector?.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  stopSnapshotPoller();
  stopConfirmationPoller();
  statsCollector?.stop();
  process.exit(0);
});

// Register as ML0 webhook subscriber.
// ML0 stores subscribers in memory, so we re-register on every startup.
let webhookSubscriptionId: string | null = null;

async function registerWebhookSubscriber(ml0Url: string, callbackUrl: string): Promise<void> {
  try {
    const resp = await fetch(`${ml0Url}/data-application/v1/webhooks/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl }),
    });
    if (resp.ok) {
      const data = await resp.json() as { id?: string };
      webhookSubscriptionId = data.id ?? null;
      console.log(`🔗 Registered as ML0 webhook subscriber: ${webhookSubscriptionId ?? 'ok'}`);
    } else {
      console.error(`❌ ML0 webhook registration failed (${resp.status}): ${await resp.text()}`);
      console.error(`   Snapshots will NOT be indexed until ML0 webhook is available.`);
    }
  } catch (err) {
    console.error(`❌ ML0 webhook registration error: ${(err as Error).message}`);
    console.error(`   Snapshots will NOT be indexed until ML0 webhook is available.`);
  }
}

// Start server
const config = getConfig();
const port = config.INDEXER_PORT;

app.listen(port, '0.0.0.0', async () => {
  console.log(`🔍 Indexer listening on port ${port} (0.0.0.0)`);
  console.log(`   Webhooks:`);
  console.log(`     POST http://localhost:${port}/webhook/snapshot`);
  console.log(`     POST http://localhost:${port}/webhook/rejection`);
  console.log(`   APIs:`);
  console.log(`     GET  http://localhost:${port}/status`);
  console.log(`     GET  http://localhost:${port}/snapshots?status=PENDING|CONFIRMED|ORPHANED`);
  console.log(`     GET  http://localhost:${port}/rejections?fiberId=...&updateType=...`);
  
  // Register with ML0 for push-based snapshot notifications
  const ml0Url = config.METAGRAPH_ML0_URL;
  const callbackUrl = process.env.INDEXER_CALLBACK_URL || `http://5.78.121.248:${port}/webhook/snapshot`;
  await registerWebhookSubscriber(ml0Url, callbackUrl);
  
  // Start low-frequency fallback poller (catches missed webhooks + fork detection)
  const snapshotPollInterval = parseInt(process.env.ML0_POLL_INTERVAL || '60000');
  startSnapshotPoller(snapshotPollInterval);
  
  // Start GL0 confirmation poller (confirms indexed snapshots against GL0)
  const confirmPollInterval = parseInt(process.env.GL0_POLL_INTERVAL || '15000');
  startConfirmationPoller(confirmPollInterval);
  
  // Start stats collector for time-series metrics (trend calculations)
  const statsCollectInterval = parseInt(process.env.STATS_COLLECT_INTERVAL || '300000'); // 5 min
  const statsAggregateInterval = parseInt(process.env.STATS_AGGREGATE_INTERVAL || '900000'); // 15 min
  statsCollector = getStatsCollector(prisma, {
    collectIntervalMs: statsCollectInterval,
    aggregateIntervalMs: statsAggregateInterval
  });
  statsCollector.start();
});
