// OttoChain Indexer
// Receives snapshot notifications from ML0, indexes state to Postgres

import express from 'express';
import { prisma, getConfig, SnapshotNotificationSchema } from '@ottochain/shared';
import { processSnapshot } from './processor.js';

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
    
    console.log(`📥 Received snapshot notification: ordinal=${notification.ordinal}`);
    
    // Process the snapshot asynchronously
    processSnapshot(notification)
      .then((result) => {
        console.log(`✅ Indexed snapshot ${notification.ordinal}: ${result.agentsUpdated} agents, ${result.contractsUpdated} contracts`);
      })
      .catch((err) => {
        console.error(`❌ Failed to index snapshot ${notification.ordinal}:`, err);
      });
    
    // Return immediately (async processing)
    res.status(202).json({ accepted: true, ordinal: notification.ordinal });
  } catch (err) {
    console.error('Invalid webhook payload:', err);
    res.status(400).json({ error: 'Invalid payload' });
  }
});

// Get indexer status
app.get('/status', async (_, res) => {
  const lastSnapshot = await prisma.indexedSnapshot.findFirst({
    orderBy: { ordinal: 'desc' },
  });
  
  const stats = {
    lastIndexedOrdinal: lastSnapshot?.ordinal ? Number(lastSnapshot.ordinal) : null,
    lastIndexedAt: lastSnapshot?.indexedAt ?? null,
    totalAgents: await prisma.agent.count(),
    totalContracts: await prisma.contract.count(),
  };
  
  res.json(stats);
});

// Start server
const config = getConfig();
const port = config.INDEXER_PORT;

app.listen(port, () => {
  console.log(`🔍 Indexer listening on port ${port}`);
  console.log(`   Webhook: POST http://localhost:${port}/webhook/snapshot`);
  console.log(`   Status:  GET  http://localhost:${port}/status`);
});
