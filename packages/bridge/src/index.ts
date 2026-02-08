// OttoChain Bridge
// Transaction signing and submission to metagraph

import express from 'express';
import { getConfig } from '@ottochain/shared';
import { walletRoutes } from './routes/wallet.js';
import { agentRoutes } from './routes/agent.js';
import { contractRoutes } from './routes/contract.js';
import { fiberRoutes } from './routes/fiber.js';
import { smRoutes } from './routes/sm.js';
import { scriptRoutes } from './routes/script.js';
import { governanceRoutes } from './routes/governance.js';
import { marketRoutes } from './routes/market.js';
import { oracleRoutes } from './routes/oracle.js';

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
app.use('/fiber', fiberRoutes);    // Generic fiber API
app.use('/sm', smRoutes);          // Generic state machine API
app.use('/script', scriptRoutes);  // Generic script oracle API
app.use('/governance', governanceRoutes); // DAO/Governance API
app.use('/market', marketRoutes);         // Market API (predictions, auctions, crowdfunding)
app.use('/oracle', oracleRoutes);         // Oracle API (registration, attestation, staking)

// Start server
const config = getConfig();
const port = config.BRIDGE_PORT;

app.listen(port, () => {
  console.log(`🌉 Bridge listening on port ${port}`);
  console.log(`   Wallet:   POST http://localhost:${port}/wallet/generate`);
  console.log(`   Agent:    POST http://localhost:${port}/agent/register`);
  console.log(`   Contract: POST http://localhost:${port}/contract/propose`);
  console.log(`   Fiber:    POST http://localhost:${port}/fiber/create`);
  console.log(`             POST http://localhost:${port}/fiber/transition`);
  console.log(`             POST http://localhost:${port}/fiber/batch`);
  console.log(`   SM:       POST http://localhost:${port}/sm/create`);
  console.log(`             POST http://localhost:${port}/sm/transition`);
  console.log(`             GET  http://localhost:${port}/sm/:fiberId`);
  console.log(`             GET  http://localhost:${port}/sm?schema=X&status=Y`);
  console.log(`   Script:   POST http://localhost:${port}/script/register`);
  console.log(`             POST http://localhost:${port}/script/invoke`);
  console.log(`             GET  http://localhost:${port}/script/:scriptId`);
  console.log(`             GET  http://localhost:${port}/script/:scriptId/result`);
  console.log(`   Govern:   POST http://localhost:${port}/governance/create-dao`);
  console.log(`             POST http://localhost:${port}/governance/propose`);
  console.log(`             POST http://localhost:${port}/governance/vote`);
  console.log(`             POST http://localhost:${port}/governance/execute`);
  console.log(`             POST http://localhost:${port}/governance/delegate`);
  console.log(`             POST http://localhost:${port}/governance/veto`);
  console.log(`             GET  http://localhost:${port}/governance/:daoId`);
  console.log(`             GET  http://localhost:${port}/governance/:daoId/proposals`);
  console.log(`   Market:   POST http://localhost:${port}/market/create`);
  console.log(`             POST http://localhost:${port}/market/open`);
  console.log(`             POST http://localhost:${port}/market/commit`);
  console.log(`             POST http://localhost:${port}/market/close`);
  console.log(`             POST http://localhost:${port}/market/resolve`);
  console.log(`             POST http://localhost:${port}/market/finalize`);
  console.log(`             POST http://localhost:${port}/market/claim`);
  console.log(`             GET  http://localhost:${port}/market/:marketId`);
  console.log(`             GET  http://localhost:${port}/market?status=X&marketType=Y`);
  console.log(`   Oracle:   POST http://localhost:${port}/oracle/register`);
  console.log(`             POST http://localhost:${port}/oracle/activate`);
  console.log(`             POST http://localhost:${port}/oracle/stake`);
  console.log(`             POST http://localhost:${port}/oracle/record-resolution`);
  console.log(`             POST http://localhost:${port}/oracle/slash`);
  console.log(`             POST http://localhost:${port}/oracle/transition`);
  console.log(`             GET  http://localhost:${port}/oracle/:oracleId`);
  console.log(`             GET  http://localhost:${port}/oracle?status=X&domain=Y`);
});
