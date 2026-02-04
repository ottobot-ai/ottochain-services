// OttoChain Bridge
// Transaction signing and submission to metagraph

import express from 'express';
import { getConfig } from '@ottochain/shared';
import { walletRoutes } from './routes/wallet.js';
import { agentRoutes } from './routes/agent.js';
import { contractRoutes } from './routes/contract.js';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'bridge' });
});

// Mount routes
app.use('/wallet', walletRoutes);
app.use('/agent', agentRoutes);
app.use('/contract', contractRoutes);

// Start server
const config = getConfig();
const port = config.BRIDGE_PORT;

app.listen(port, () => {
  console.log(`🌉 Bridge listening on port ${port}`);
  console.log(`   Wallet:   POST http://localhost:${port}/wallet/generate`);
  console.log(`   Agent:    POST http://localhost:${port}/agent/register`);
  console.log(`   Contract: POST http://localhost:${port}/contract/propose`);
});
