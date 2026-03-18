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
import { corporateRoutes } from './routes/corporate.js';
import { tokenRoutes } from './routes/token.js';
import { internalRoutes } from './routes/internal.js';     // Internal service-to-service API
import { buildRoutes } from './routes/build.js';
import { submitRoutes } from './routes/submit.js';
import { responseTimeTracker } from './lib/response-time-tracker.js';
import { confirmationRegistry } from './lib/confirmation-registry.js';

const app = express();
app.use(express.json({ limit: '1mb' })); // Larger limit for state machine definitions

// ── Response-time tracking middleware ─────────────────────────────────────────
// Records duration of every request EXCEPT /health (to avoid self-measurement).
app.use((req, res, next) => {
  if (req.path === '/health') {
    next();
    return;
  }
  const start = Date.now();
  res.on('finish', () => {
    responseTimeTracker.record(Date.now() - start);
  });
  next();
});

// Health check — includes p50/p95/p99 response time metrics
app.get('/health', (_, res) => {
  const { p50, p95, p99 } = responseTimeTracker.percentiles();
  res.json({
    status: 'ok',
    service: 'bridge',
    responseTime: { p50, p95, p99 },
    pendingConfirmations: confirmationRegistry.size,
  });
});

// Version info
app.get('/version', (_, res) => {
  res.json({
    service: 'bridge',
    version: process.env.npm_package_version ?? '0.1.0',
    commit: process.env.GIT_SHA ?? 'unknown',
    built: process.env.BUILD_TIME ?? 'unknown',
    node: process.version,
  });
});

// Mount routes
app.use('/wallet', walletRoutes);
app.use('/agent', agentRoutes);
app.use('/contract', contractRoutes);
app.use('/fiber', fiberRoutes);    // Generic fiber API
app.use('/sm', smRoutes);          // Generic state machine API (legacy, server-signed)
app.use('/build', buildRoutes);    // Client-side signing: build unsigned payloads
app.use('/submit', submitRoutes);  // Client-side signing: relay pre-signed transactions
app.use('/script', scriptRoutes);  // Generic script oracle API
app.use('/governance', governanceRoutes); // DAO/Governance API
app.use('/market', marketRoutes);         // Market API (predictions, auctions, crowdfunding)
app.use('/oracle', oracleRoutes);         // Oracle API (registration, attestation, staking)
app.use('/corporate', corporateRoutes);   // Corporate governance API (entities, board, shareholders)
app.use('/token', tokenRoutes);           // Token API (create, transfer, split, merge, burn, expire)
app.use('/internal', internalRoutes);     // Internal service-to-service (indexer → bridge callbacks)

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
  console.log(`   Corp:     POST http://localhost:${port}/corporate/incorporate`);
  console.log(`             POST http://localhost:${port}/corporate/amend-charter`);
  console.log(`             GET  http://localhost:${port}/corporate/:entityId`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/board/elect`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/board/meeting`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/board/resolution`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/board/consent`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/shareholders/meeting`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/shareholders/vote`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/shareholders/proxy`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/officers/appoint`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/officers/remove`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/securities/issue`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/securities/transfer`);
  console.log(`             POST http://localhost:${port}/corporate/:entityId/compliance/file`);
  console.log(`             GET  http://localhost:${port}/corporate/:entityId/compliance`);
  console.log(`             GET  http://localhost:${port}/corporate`);
  console.log(`   Token:    POST http://localhost:${port}/token/create`);
  console.log(`             POST http://localhost:${port}/token/transfer`);
  console.log(`             POST http://localhost:${port}/token/split`);
  console.log(`             POST http://localhost:${port}/token/merge`);
  console.log(`             POST http://localhost:${port}/token/burn`);
  console.log(`             POST http://localhost:${port}/token/expire`);
  console.log(`             GET  http://localhost:${port}/token/:tokenId`);
  console.log(`             GET  http://localhost:${port}/token`);
});
