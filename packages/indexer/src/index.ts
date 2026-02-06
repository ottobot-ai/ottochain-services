// OttoChain Indexer
// Receives snapshot notifications from ML0 via webhook push, indexes state to Postgres
// Confirms snapshots against GL0 global snapshots
// Low-frequency fallback poller catches missed webhooks + detects forks across peers

import express from 'express';
import { prisma, getConfig, SnapshotNotificationSchema } from '@ottochain/shared';
import { processSnapshot } from './processor.js';
import { startConfirmationPoller, stopConfirmationPoller, getConfirmationStats } from './confirmations.js';
import { startSnapshotPoller, stopSnapshotPoller, getPollerStats } from './poller.js';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'indexer' });
});

// Webhook endpoint for ML0 snapshot notifications
app.post('/webhook/snapshot', async (req, res) => {
  try {
    // Validate incoming payload
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  stopSnapshotPoller();
  stopConfirmationPoller();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  stopSnapshotPoller();
  stopConfirmationPoller();
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
  console.log(`   Webhook:   POST http://localhost:${port}/webhook/snapshot`);
  console.log(`   Status:    GET  http://localhost:${port}/status`);
  console.log(`   Snapshots: GET  http://localhost:${port}/snapshots?status=PENDING|CONFIRMED|ORPHANED`);
  
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
});
