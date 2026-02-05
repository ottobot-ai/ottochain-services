// OttoChain Indexer
// Receives snapshot notifications from ML0, indexes state to Postgres
// Confirms snapshots against GL0 global snapshots

import express from 'express';
import { prisma, getConfig, SnapshotNotificationSchema } from '@ottochain/shared';
import { processSnapshot } from './processor.js';
import { startConfirmationPoller, stopConfirmationPoller, getConfirmationStats } from './confirmations.js';

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
  
  const stats = {
    lastIndexedOrdinal: lastSnapshot?.ordinal ? Number(lastSnapshot.ordinal) : null,
    lastIndexedAt: lastSnapshot?.indexedAt ?? null,
    lastIndexedStatus: lastSnapshot?.status ?? null,
    lastConfirmedOrdinal: lastConfirmed?.ordinal ? Number(lastConfirmed.ordinal) : null,
    lastConfirmedAt: lastConfirmed?.confirmedAt ?? null,
    confirmations: confirmationStats,
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
  stopConfirmationPoller();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  stopConfirmationPoller();
  process.exit(0);
});

// Start server
const config = getConfig();
const port = config.INDEXER_PORT;

app.listen(port, '0.0.0.0', () => {
  console.log(`🔍 Indexer listening on port ${port} (0.0.0.0)`);
  console.log(`   Webhook:   POST http://localhost:${port}/webhook/snapshot`);
  console.log(`   Status:    GET  http://localhost:${port}/status`);
  console.log(`   Snapshots: GET  http://localhost:${port}/snapshots?status=PENDING|CONFIRMED|ORPHANED`);
  
  // Start GL0 confirmation poller (every 5 seconds)
  const pollInterval = parseInt(process.env.GL0_POLL_INTERVAL || '5000');
  startConfirmationPoller(pollInterval);
});
