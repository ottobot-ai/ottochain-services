/**
 * OttoChain Traffic Generator
 *
 * Continuous traffic generator using weighted fiber selection via FiberOrchestrator.
 *
 * Usage:
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 npx tsx src/index.ts
 *
 *   # Optional: custom fiber weights
 *   FIBER_WEIGHTS='{"escrow":0.2,"predictionMarket":0.3}' npx tsx src/index.ts
 *
 *   # Use a persistent wallet pool
 *   npx tsx src/index.ts --wallets ./wallets.json
 */

import 'dotenv/config';
import { FiberOrchestrator, type TrafficConfig } from './orchestrator.js';
import { BridgeClient } from './bridge-client.js';
import { loadWalletPool } from './wallets.js';
import {
  startStatusServer,
  setStatusProvider,
  setControlCallbacks,
  type TrafficGenStatus,
} from './status-server.js';
import type { Agent } from './types.js';
import { SdkAgentState as AgentState } from './types.js';

// =============================================================================
// Configuration from Environment
// =============================================================================

function loadTrafficConfig(): TrafficConfig {
  const defaultWeights: Record<string, number> = {
    // Contract workflows (27%)
    escrow: 0.10,
    arbitratedEscrow: 0.07,
    simpleOrder: 0.06,
    approval: 0.04,
    // Custom workflows (9%)
    ticTacToe: 0.05,
    voting: 0.04,
    // Market workflows (28%)
    predictionMarket: 0.08,
    auctionMarket: 0.07,
    crowdfundMarket: 0.07,
    groupBuyMarket: 0.06,
    // DAO workflows (15%)
    tokenDAO: 0.06,
    multisigDAO: 0.05,
    thresholdDAO: 0.04,
    // Governance workflows (5%)
    simpleGovernance: 0.05,
    // Corporate Governance workflows (16%)
    corporateEntity: 0.05,
    corporateBoard: 0.04,
    corporateShareholders: 0.04,
    corporateSecurities: 0.03,
  };

  let fiberWeights = defaultWeights;
  if (process.env.FIBER_WEIGHTS) {
    try {
      fiberWeights = JSON.parse(process.env.FIBER_WEIGHTS);
    } catch {
      console.warn('⚠️  Invalid FIBER_WEIGHTS JSON, using defaults');
    }
  }

  const indexerEnabled = process.env.INDEXER_VERIFY === 'true' || !!process.env.INDEXER_URL;
  const indexerConfig = indexerEnabled
    ? {
        enabled: true,
        url: process.env.INDEXER_URL ?? 'http://localhost:3031',
        waitTimeoutMs: parseInt(process.env.INDEXER_WAIT_TIMEOUT ?? '30000', 10),
        pollIntervalMs: parseInt(process.env.INDEXER_POLL_INTERVAL ?? '2000', 10),
        maxRetries: parseInt(process.env.INDEXER_MAX_RETRIES ?? '3', 10),
        skipOnRejection: process.env.INDEXER_SKIP_ON_REJECTION !== 'false',
      }
    : undefined;

  return {
    generationIntervalMs: parseInt(process.env.GENERATION_INTERVAL_MS ?? '30000', 10),
    targetActiveFibers: parseInt(process.env.TARGET_ACTIVE_FIBERS ?? '20', 10),
    fiberWeights,
    indexer: indexerConfig,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const statusPort = parseInt(process.env.STATUS_PORT ?? '3033', 10);
  const startedAt = new Date().toISOString();

  await startStatusServer(statusPort);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Traffic Generator (FiberOrchestrator)');
  console.log('═══════════════════════════════════════════════════════════════');

  const config = loadTrafficConfig();

  console.log(`   Target active fibers: ${config.targetActiveFibers}`);
  console.log(`   Generation interval:  ${config.generationIntervalMs}ms`);
  if (config.indexer?.enabled) {
    console.log(`   Indexer verification: ENABLED (${config.indexer.url})`);
  } else {
    console.log(`   Indexer verification: disabled`);
  }
  console.log('   Fiber weights:');
  for (const [type, weight] of Object.entries(config.fiberWeights)) {
    console.log(`     ${type}: ${(weight * 100).toFixed(0)}%`);
  }

  // Load wallet pool
  const walletPoolPath =
    process.argv.includes('--wallets')
      ? process.argv[process.argv.indexOf('--wallets') + 1]
      : process.env.WALLET_POOL_PATH ?? './wallets.json';

  const walletPool = await loadWalletPool(walletPoolPath);
  if (!walletPool) {
    console.error(`❌ Failed to load wallet pool from ${walletPoolPath}`);
    console.error('   Run: node dist/wallets.js generate --count 200');
    process.exit(1);
  }
  console.log(`   Wallet pool: ${walletPool.wallets.length} wallets loaded`);

  // Create bridge client
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://localhost:3030';
  const ml0Url = process.env.ML0_URL ?? 'http://localhost:9200';

  const bridge = new BridgeClient({ bridgeUrl, ml0Url });

  // Convert wallet pool to agents
  const agents: Agent[] = walletPool.wallets.map((w, i) => ({
    address: w.address,
    privateKey: w.privateKey,
    fiberId: w.agentId ?? null,
    state: w.agentId ? AgentState.AGENT_STATE_REGISTERED : 'UNREGISTERED',
    fitness: { reputation: 0, completionRate: 0, networkEffect: 0, age: 0, total: 0 },
    meta: {
      birthGeneration: 0,
      displayName: `Agent_${i}`,
      platform: w.platform ?? 'simulation',
      vouchedFor: new Set(),
      receivedVouches: new Set(),
      activeContracts: new Set(),
      completedContracts: 0,
      failedContracts: 0,
      riskTolerance: 0.5,
      activeMarkets: new Set(),
      marketsCreated: 0,
      marketWins: 0,
      marketLosses: 0,
      totalMarketCommitments: 0,
      totalMarketWinnings: 0,
      isOracle: Math.random() < 0.1,
      oracleResolutions: 0,
    },
  }));

  // Create orchestrator
  const orchestrator = new FiberOrchestrator(
    config,
    bridge,
    () => agents.filter((a) => a.state !== 'UNREGISTERED'),
  );

  // Track running state for control callbacks
  let running = false;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  // Status provider
  setStatusProvider((): TrafficGenStatus => {
    const stats = orchestrator.getStats();
    return {
      enabled: running,
      mode: running ? 'orchestrator' : 'idle',
      targetTps: 0,
      targetPopulation: agents.length,
      currentPopulation: agents.filter((a) => a.state !== 'UNREGISTERED').length,
      currentTps: 0,
      generation,
      totalTransactions: stats.completedFibers + stats.failedFibers,
      successRate: stats.completedFibers / Math.max(1, stats.completedFibers + stats.failedFibers),
      uptime: Date.now() - new Date(startedAt).getTime(),
      startedAt,
    };
  });

  async function tick() {
    // Check network health
    try {
      const syncStatus = await bridge.checkSyncStatus();
      if (!syncStatus.ready) {
        const reason = !syncStatus.allReady
          ? 'Nodes not ready'
          : !syncStatus.allHealthy
            ? 'Nodes unhealthy'
            : syncStatus.gl0?.fork
              ? 'GL0 fork detected'
              : syncStatus.ml0?.fork
                ? 'ML0 fork detected'
                : 'Unknown';
        console.log(`⏸️  Skipping tick — network not ready: ${reason}`);
        return;
      }
    } catch (e) {
      console.log(`⏸️  Skipping tick — sync check failed: ${e}`);
      return;
    }

    generation++;
    try {
      const result = await orchestrator.tick();
      if (result.skipped) {
        console.log(`Tick ${generation}: ⏸️  Skipped (network not ready)`);
        return;
      }
      const stats = orchestrator.getStats();
      console.log(`Tick ${generation}: active=${stats.activeFibers} created=${result.created} driven=${result.driven} completed=${result.completed}${result.rejected > 0 ? ` rejected=${result.rejected}` : ''}`);
      console.log(`  Distribution: ${JSON.stringify(stats.fiberTypeDistribution)}`);
    } catch (e) {
      console.error(`❌ Tick error: ${e}`);
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    intervalHandle = setInterval(tick, config.generationIntervalMs);
    console.log('\n🚀 Traffic generation started.');
  }

  function stopLoop() {
    if (!running) return;
    running = false;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    console.log('\n⏹️  Traffic generation stopped.');
  }

  // Control callbacks for status-server
  setControlCallbacks({
    onStart: async () => startLoop(),
    onStop: async () => stopLoop(),
    onConfig: async (newConfig) => {
      console.log('⚙️  Config update via API:', newConfig);
      // Dynamic config updates not supported without restart
    },
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📊 Shutting down...');
    stopLoop();
    const stats = orchestrator.getStats();
    console.log(`Final: ${stats.activeFibers} active, ${stats.completedFibers} completed, ${stats.failedFibers} failed`);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopLoop();
    process.exit(0);
  });

  console.log('──────────────────────────────────────────────────────────────');

  // Bootstrap: register agents before starting the loop
  const targetAgents = Math.min(config.targetActiveFibers * 3, agents.length);
  await orchestrator.bootstrapAgents(targetAgents);

  const autoStart = process.env.AUTO_START !== 'false';
  if (autoStart) {
    console.log('\n🚀 Auto-starting (set AUTO_START=false to disable)...');
    startLoop();
    // Run first tick immediately
    await tick();
  } else {
    console.log('\n⏸️  Waiting for start command (POST /start)...');
    await new Promise(() => {});
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Re-export for programmatic use
export { FiberOrchestrator } from './orchestrator.js';
export { BridgeClient } from './bridge-client.js';
export * from './types.js';
export * from './workflows.js';
export * from './wallets.js';
export * from './fiber-definitions.js';
export * from './market-workflows.js';
export * from './status-server.js';
