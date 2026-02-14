// OttoChain Bridge
// Transaction signing and submission to metagraph

import express from 'express';
import { getConfig } from '@ottochain/shared';
import { walletRoutes } from './routes/wallet.js';
import { agentRoutes } from './routes/agent.js';
import { contractRoutes } from './routes/contract.js';
import { fiberRoutes } from './routes/fiber.js';
// import delegationRoutes from './routes/delegation.js';
// import delegationFeesRoutes from './routes/delegation-fees.js';
// import intentRoutes from './routes/intents.js';

const app = express();
app.use(express.json({ limit: '1mb' })); // Larger limit for state machine definitions

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'bridge' });
});

// Mount routes
app.use('/wallet', walletRoutes);
app.use('/agent', agentRoutes);
app.use('/contract', contractRoutes);
app.use('/fiber', fiberRoutes);  // Generic fiber API
// app.use('/delegation', delegationRoutes);  // Delegation management
// app.use('/delegation-fees', delegationFeesRoutes);  // Delegation fee calculation & distribution
// app.use('/api', intentRoutes);  // Intent layer for semantic delegation validation

// Start server
const config = getConfig();
const port = config.BRIDGE_PORT;

app.listen(port, () => {
  console.log(`🌉 Bridge listening on port ${port}`);
  console.log(`   Wallet:     POST http://localhost:${port}/wallet/generate`);
  console.log(`   Agent:      POST http://localhost:${port}/agent/register`);
  console.log(`   Contract:   POST http://localhost:${port}/contract/propose`);
  console.log(`   Fiber:      POST http://localhost:${port}/fiber/create`);
  console.log(`               POST http://localhost:${port}/fiber/transition`);
  console.log(`               POST http://localhost:${port}/fiber/batch`);
  // console.log(`   Delegation: POST http://localhost:${port}/delegation/create`);
  // console.log(`               POST http://localhost:${port}/delegation/submit`);
  // console.log(`               GET  http://localhost:${port}/delegation/list`);
  // console.log(`   Del. Fees:  POST http://localhost:${port}/delegation-fees/calculate`);
  // console.log(`               POST http://localhost:${port}/delegation-fees/distribute`);
  // console.log(`               GET  http://localhost:${port}/delegation-fees/analytics`);
  // console.log(`   Intents:    POST http://localhost:${port}/api/intent/create`);
  // console.log(`               POST http://localhost:${port}/api/intent/submit`);
  // console.log(`               POST http://localhost:${port}/api/intent/cancel`);
  // console.log(`               GET  http://localhost:${port}/api/intent/list`);
});
