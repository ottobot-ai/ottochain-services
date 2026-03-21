/**
 * OttoChain Traffic Generator v2
 * 
 * Weighted distribution traffic generator for the OttoChain metagraph.
 * Drives fibers through their complete lifecycle using simple weighted random selection.
 * 
 * Features:
 *  - Fixed pool of 26 deterministic agent keypairs
 *  - Weighted random selection of fiber types (no GA complexity)
 *  - Full fiber lifecycle: create → progress → complete/archive
 *  - Multi-agent coordination: contracts need 2 parties, markets need N committers, DAOs need voters
 *  - Vouching on successful completion
 *  - Indexer verification for transaction confirmation
 * 
 * Usage:
 *   BRIDGE_URL=http://172.30.0.53:3030 INDEXER_URL=http://172.30.0.54:3031 npx tsx src/index.ts
 * 
 * Environment:
 *   BRIDGE_URL         - Bridge service URL (required)
 *   INDEXER_URL        - Indexer service URL (required for verification)
 *   TARGET_ACTIVE_FIBERS - Number of concurrent fibers to maintain (default: 20)
 *   GENERATION_INTERVAL_MS - Tick interval in ms (default: 30000)
 *   FIBER_WEIGHTS      - JSON object of fiber type weights (optional)
 */

import 'dotenv/config';
import type { Agent } from './types.js';
import { SdkAgentState as IdentityState } from './types.js';
import { FiberOrchestrator, TrafficConfig } from './orchestrator.js';
import { BridgeClient } from './bridge-client.js';
import { generateFixedAgentPool, type FixedAgent } from './agents.js';
import { startStatusServer, setStatusProvider, setWeightsProvider, setFibersProvider, setAgentsProvider, setControlCallbacks, type ActiveFiberStatus, type CompletedFiberStatus } from './status-server.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default weights per app type (must sum to 1.0)
 * 
 * App type distribution:
 *  - Identity: 0.20 (agent registration/activation is bootstrapped separately)
 *  - Contracts: 0.25
 *  - Markets: 0.25
 *  - DAOs: 0.15
 *  - Oracles: 0.15
 */
const DEFAULT_FIBER_WEIGHTS: Record<string, number> = {
  // Contract workflows (25%)
  escrow: 0.10,
  arbitratedEscrow: 0.08,
  simpleOrder: 0.07,
  
  // Market workflows (25%)
  predictionMarket: 0.10,
  auctionMarket: 0.08,
  crowdfundMarket: 0.07,
  
  // DAO workflows (15%)
  tokenDAO: 0.06,
  multisigDAO: 0.05,
  thresholdDAO: 0.04,
  
  // Governance workflows (15%)
  simpleGovernance: 0.08,
  corporateEntity: 0.04,
  corporateBoard: 0.03,
  
  // Custom/Game workflows (20%)
  ticTacToe: 0.10,
  voting: 0.06,
  approval: 0.04,
};

function loadConfig(): TrafficConfig {
  // Parse fiber weights from env or use defaults
  let fiberWeights = DEFAULT_FIBER_WEIGHTS;
  if (process.env.FIBER_WEIGHTS) {
    try {
      fiberWeights = JSON.parse(process.env.FIBER_WEIGHTS);
      // Validate weights sum to ~1.0
      const sum = Object.values(fiberWeights).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) > 0.01) {
        console.warn(`⚠️  FIBER_WEIGHTS sum to ${sum.toFixed(2)}, expected 1.0`);
      }
    } catch (e) {
      console.warn('⚠️  Invalid FIBER_WEIGHTS JSON, using defaults');
    }
  }

  // Indexer config - NOTE: loadConfig() bug workaround for PR #216
  // The original loadConfig doesn't read INDEXER_URL, so we handle it here
  const indexerUrl = process.env.INDEXER_URL;
  const indexerEnabled = !!indexerUrl;
  
  const indexerConfig = indexerEnabled ? {
    enabled: true,
    url: indexerUrl!,
    waitTimeoutMs: parseInt(process.env.INDEXER_WAIT_TIMEOUT ?? '30000', 10),
    pollIntervalMs: parseInt(process.env.INDEXER_POLL_INTERVAL ?? '2000', 10),
    maxRetries: parseInt(process.env.INDEXER_MAX_RETRIES ?? '3', 10),
    skipOnRejection: process.env.INDEXER_SKIP_ON_REJECTION !== 'false',
  } : undefined;

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
  const config = loadConfig();
  
  // Start status server for monitoring (before everything else)
  const statusPort = parseInt(process.env.STATUS_PORT ?? '3033', 10);
  const startedAt = new Date().toISOString();
  await startStatusServer(statusPort);

  // Required: BRIDGE_URL
  const bridgeUrl = process.env.BRIDGE_URL;
  if (!bridgeUrl) {
    console.error('❌ BRIDGE_URL environment variable is required');
    console.error('   Example: BRIDGE_URL=http://172.30.0.53:3030 npx tsx src/index.ts');
    process.exit(1);
  }
  
  // ML0 URL for direct queries (optional, defaults to bridge)
  const ml0Url = process.env.ML0_URL ?? bridgeUrl;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Traffic Generator v2');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Bridge: ${bridgeUrl}`);
  console.log(`   Target active fibers: ${config.targetActiveFibers}`);
  console.log(`   Tick interval: ${config.generationIntervalMs}ms`);
  
  if (config.indexer?.enabled) {
    console.log(`   Indexer verification: ENABLED`);
    console.log(`     URL: ${config.indexer.url}`);
    console.log(`     Wait timeout: ${config.indexer.waitTimeoutMs}ms`);
    console.log(`     Max retries: ${config.indexer.maxRetries}`);
  } else {
    console.log(`   Indexer verification: disabled (set INDEXER_URL to enable)`);
  }
  
  console.log(`   Fiber weights:`);
  const sortedWeights = Object.entries(config.fiberWeights)
    .sort((a, b) => b[1] - a[1]);
  for (const [type, weight] of sortedWeights) {
    console.log(`     ${type}: ${(weight * 100).toFixed(0)}%`);
  }
  
  // Generate fixed agent pool (26 deterministic keypairs)
  console.log('\n🔑 Generating fixed agent pool...');
  const fixedAgents = generateFixedAgentPool();
  console.log(`   Generated ${fixedAgents.length} agents`);
  
  // Convert to Agent type for orchestrator
  const agents: Agent[] = fixedAgents.map((fa, i) => ({
    address: fa.address,
    privateKey: fa.privateKey,
    fiberId: null,
    state: 'UNREGISTERED' as const,
    fitness: { reputation: 0, completionRate: 0, networkEffect: 0, age: 0, total: 0 },
    meta: {
      birthGeneration: 0,
      displayName: fa.name,
      platform: fa.platform,
      vouchedFor: new Set<string>(),
      receivedVouches: new Set<string>(),
      activeContracts: new Set<string>(),
      completedContracts: 0,
      failedContracts: 0,
      riskTolerance: 0.5,
      activeMarkets: new Set<string>(),
      marketsCreated: 0,
      marketWins: 0,
      marketLosses: 0,
      totalMarketCommitments: 0,
      totalMarketWinnings: 0,
      isOracle: fa.isOracle,
      oracleResolutions: 0,
    },
  }));
  
  // Track registered agents
  const registeredAgents = new Set<string>();
  
  // Create bridge client
  const bridge = new BridgeClient({ bridgeUrl, ml0Url });
  
  // Create orchestrator
  const orchestrator = new FiberOrchestrator(
    config,
    bridge,
    () => agents.filter(a => registeredAgents.has(a.address))
  );
  
  // Wire up status-server providers for monitoring
  // Wire up v2 status provider (no GA fields - uses fiber-centric metrics)
  setStatusProvider(() => {
    const stats = orchestrator.getStats();
    const total = stats.completedFibers + stats.failedFibers;
    return {
      enabled: true,
      mode: 'orchestrator',
      targetActiveFibers: config.targetActiveFibers,
      activeFibers: stats.activeFibers,
      completedFibers: stats.completedFibers,
      failedFibers: stats.failedFibers,
      successRate: total > 0 ? stats.completedFibers / total : 0,
      fiberTypeDistribution: stats.fiberTypeDistribution,
      uptime: Date.now() - new Date(startedAt).getTime(),
      startedAt,
    };
  });

  setWeightsProvider(() => orchestrator.getWeights());
  
  setFibersProvider(() => ({
    active: orchestrator.getActiveFibers().map((f): ActiveFiberStatus => ({
      id: f.id,
      type: f.type,
      currentState: f.currentState,
      participants: Array.from(f.participants.keys()),
      startedAt: f.startedAt,
      pending: !!f.pendingTransition,
    })),
    completed: orchestrator.getCompletedFiberLog().map((f): CompletedFiberStatus => ({
      id: f.id,
      type: f.type,
      finalState: f.finalState,
      completedAt: f.completedAt,
    })),
    failed: orchestrator.getStats().failedFibers,
  }));
  
  setAgentsProvider(() => ({
    registered: orchestrator.getRegisteredAgents(),
    count: orchestrator.getRegisteredAgents().length,
  }));
  
  setControlCallbacks({
    onWeightsUpdate: (weights) => orchestrator.updateWeights(weights),
  });
  
  console.log('──────────────────────────────────────────────────────────────');
  
  // Bootstrap: Register and activate all agents (idempotent)
  console.log('\n🆔 Registering agents...');
  for (const agent of agents) {
    try {
      const result = await bridge.registerAgent(
        agent.privateKey,
        agent.meta.displayName,
        agent.meta.platform,
        agent.address.slice(0, 16)
      );
      
      // Activate the agent
      await bridge.activateAgent(agent.privateKey, result.fiberId);
      
      agent.fiberId = result.fiberId;
      agent.state = IdentityState.AGENT_STATE_ACTIVE;
      registeredAgents.add(agent.address);
      console.log(`  ✅ ${agent.meta.displayName}: ${result.fiberId.slice(0, 12)}...`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')) {
        // Already registered - mark as active
        registeredAgents.add(agent.address);
        agent.state = IdentityState.AGENT_STATE_ACTIVE;
        console.log(`  ✓ ${agent.meta.displayName}: already registered`);
      } else {
        console.log(`  ⚠️  ${agent.meta.displayName}: ${msg.slice(0, 60)}`);
      }
    }
  }
  
  console.log(`\n📊 ${registeredAgents.size}/${agents.length} agents ready`);
  
  if (registeredAgents.size < 2) {
    console.error('❌ Need at least 2 registered agents to run traffic generator');
    process.exit(1);
  }
  
  console.log('\n🚀 Starting traffic generator...\n');
  
  // Main loop
  let generation = 0;
  const interval = setInterval(async () => {
    generation++;
    
    try {
      const result = await orchestrator.tick();
      
      if (result.skipped) {
        console.log(`Tick ${generation}: ⏸️  Skipped (network not ready)`);
        return;
      }
      
      const stats = orchestrator.getStats();
      console.log(`Tick ${generation}:`);
      console.log(`  Active: ${stats.activeFibers} | Created: ${result.created} | Driven: ${result.driven} | Completed: ${result.completed}`);
      
      if (result.rejected > 0 || result.pending > 0 || stats.failedFibers > 0) {
        console.log(`  Rejected: ${result.rejected} | Pending: ${result.pending} | Total Failed: ${stats.failedFibers}`);
      }
      
      // Show fiber type distribution
      const dist = stats.fiberTypeDistribution;
      if (Object.keys(dist).length > 0) {
        const distStr = Object.entries(dist)
          .filter(([_, count]) => count > 0)
          .map(([type, count]) => `${type}:${count}`)
          .join(' ');
        console.log(`  Types: ${distStr}`);
      }
    } catch (e) {
      console.error(`❌ Tick error: ${e}`);
    }
  }, config.generationIntervalMs);
  
  // Graceful shutdown
  const shutdown = () => {
    console.log('\n📊 Shutting down...');
    clearInterval(interval);
    const stats = orchestrator.getStats();
    console.log(`Final: ${stats.activeFibers} active, ${stats.completedFibers} completed, ${stats.failedFibers} failed`);
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Re-export for programmatic use
export { FiberOrchestrator } from './orchestrator.js';
export { BridgeClient } from './bridge-client.js';
export { generateFixedAgentPool } from './agents.js';
export * from './types.js';
export * from './workflows.js';
export * from './fiber-definitions.js';
export * from './market-workflows.js';
export * from './status-server.js';
