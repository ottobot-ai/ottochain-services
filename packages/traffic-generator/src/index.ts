/**
 * OttoChain Evolutionary Traffic Generator
 * 
 * Continuous traffic generator using genetic algorithm-inspired selection
 * to simulate realistic agent population dynamics on the OttoChain metagraph.
 * 
 * Features:
 *  - Fitness-weighted agent selection (reputation, completion rate, network effect, age)
 *  - Softmax transition selection with temperature annealing
 *  - Mutation for exploration of unexpected paths
 *  - Population dynamics (births, deaths)
 *  - Multiple workflow types (AgentIdentity, Contract, Voting, TokenEscrow, TicTacToe, etc.)
 *  - High-throughput mode for 1000+ agents at 10+ TPS
 * 
 * Usage:
 *   # Standard mode
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 npx tsx src/index.ts
 * 
 *   # High-throughput mode (1000 agents, 10 TPS, all workflows)
 *   npx tsx src/index.ts --high-throughput
 *   # or
 *   MODE=high-throughput TARGET_POPULATION=1000 TARGET_TPS=10 npx tsx src/index.ts
 */

import 'dotenv/config';
import type { GeneratorConfig, GenerationStats, Agent } from './types.js';
import { DEFAULT_CONFIG, SdkAgentState as AgentState } from './types.js';
import { Simulator } from './simulator.js';
import { HighThroughputSimulator, runHighThroughput } from './high-throughput.js';
import { FiberOrchestrator, TrafficConfig } from './orchestrator.js';
import { BridgeClient } from './bridge-client.js';
import { loadWalletPool, type WalletPool } from './wallets.js';
import { startStatusServer, setStatusProvider, type TrafficGenStatus } from './status-server.js';

// =============================================================================
// Configuration from Environment
// =============================================================================

function loadConfig(): GeneratorConfig {
  // Parse CLI args for wallet pool
  const walletPoolIdx = process.argv.indexOf('--wallets');
  const walletPoolPath = walletPoolIdx !== -1 && process.argv[walletPoolIdx + 1]
    ? process.argv[walletPoolIdx + 1]
    : process.env.WALLET_POOL_PATH;
  
  return {
    ...DEFAULT_CONFIG,
    targetPopulation: parseInt(process.env.TARGET_POPULATION ?? '100', 10),
    birthRate: parseInt(process.env.BIRTH_RATE ?? '2', 10),
    deathRate: parseFloat(process.env.DEATH_RATE ?? '0.05'),
    activityRate: parseFloat(process.env.ACTIVITY_RATE ?? '0.4'),
    proposalRate: parseFloat(process.env.PROPOSAL_RATE ?? '0.3'),
    mutationRate: parseFloat(process.env.MUTATION_RATE ?? '0.1'),
    initialTemperature: parseFloat(process.env.INITIAL_TEMPERATURE ?? '1.0'),
    temperatureDecay: parseFloat(process.env.TEMPERATURE_DECAY ?? '0.995'),
    minTemperature: parseFloat(process.env.MIN_TEMPERATURE ?? '0.1'),
    generationIntervalMs: parseInt(process.env.GENERATION_INTERVAL_MS ?? '5000', 10),
    maxGenerations: parseInt(process.env.MAX_GENERATIONS ?? '0', 10),
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
    ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
    platforms: (process.env.PLATFORMS ?? 'discord,telegram,twitter,github').split(','),
    seed: process.env.SEED ? parseInt(process.env.SEED, 10) : undefined,
    walletPoolPath,
  };
}

// =============================================================================
// Logging
// =============================================================================

function formatStats(stats: GenerationStats): string {
  const lines = [
    `Generation ${stats.generation} @ ${stats.timestamp.toISOString()}`,
    `  Population: ${stats.populationSize} (births: ${stats.births}, deaths: ${stats.deaths})`,
    `  Transactions: ${stats.successes}/${stats.transactions} (${stats.failures} failed)`,
    `  Contracts: ${stats.completions} completed, ${stats.rejections} rejected, ${stats.disputes} disputed`,
    `  Markets: ${stats.activeMarkets} active (${stats.marketsCreated} created, ${stats.marketsSettled} settled, ${stats.marketCommitments} commits)`,
    `  Mutations: ${stats.mutations}`,
    `  Fitness: avg=${stats.avgFitness.toFixed(3)}, max=${stats.maxFitness.toFixed(3)}`,
  ];
  return lines.join('\n');
}

// =============================================================================
// Weighted Orchestrator Mode
// =============================================================================

function loadTrafficConfig(): TrafficConfig {
  // Parse fiber weights from env or use defaults
  // Includes Contract/Custom, Market, DAO, Governance, and Corporate workflows
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
  
  // Allow override via FIBER_WEIGHTS env var (JSON string)
  let fiberWeights = defaultWeights;
  if (process.env.FIBER_WEIGHTS) {
    try {
      fiberWeights = JSON.parse(process.env.FIBER_WEIGHTS);
    } catch (e) {
      console.warn('⚠️  Invalid FIBER_WEIGHTS JSON, using defaults');
    }
  }
  
  // Parse indexer configuration
  const indexerEnabled = process.env.INDEXER_VERIFY === 'true' || process.env.INDEXER_URL;
  const indexerConfig = indexerEnabled ? {
    enabled: true,
    url: process.env.INDEXER_URL ?? 'http://localhost:3031',
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

async function runWeightedOrchestrator(): Promise<void> {
  const config = loadTrafficConfig();
  const walletPoolPath = process.argv.includes('--wallets') 
    ? process.argv[process.argv.indexOf('--wallets') + 1]
    : process.env.WALLET_POOL_PATH ?? './wallets.json';
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain WEIGHTED Traffic Generator');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Target active fibers: ${config.targetActiveFibers}`);
  console.log(`   Generation interval: ${config.generationIntervalMs}ms`);
  if (config.indexer?.enabled) {
    console.log(`   Indexer verification: ENABLED`);
    console.log(`     URL: ${config.indexer.url}`);
    console.log(`     Wait timeout: ${config.indexer.waitTimeoutMs}ms`);
    console.log(`     Max retries: ${config.indexer.maxRetries}`);
  } else {
    console.log(`   Indexer verification: disabled`);
  }
  console.log(`   Fiber weights:`);
  for (const [type, weight] of Object.entries(config.fiberWeights)) {
    console.log(`     ${type}: ${(weight * 100).toFixed(0)}%`);
  }
  
  // Load wallet pool
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
  const monitorUrl = process.env.MONITOR_URL ?? 'http://localhost:3032';
  
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
      // Market-related fields
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
    () => agents.filter(a => a.state !== 'UNREGISTERED') // Only return registered agents
  );
  
  console.log('──────────────────────────────────────────────────────────────');
  
  // Bootstrap: Register agents first (needed before contracts)
  const targetAgents = Math.min(config.targetActiveFibers * 3, agents.length);
  await orchestrator.bootstrapAgents(targetAgents);
  
  console.log('\n🚀 Starting weighted orchestrator...\n');
  
  // Main loop
  let generation = 0;
  const interval = setInterval(async () => {
    generation++;
    
    // Check network health first
    try {
      const syncStatus = await bridge.checkSyncStatus();
      if (!syncStatus.ready) {
        const reason = !syncStatus.allReady ? 'Nodes not ready' :
                       !syncStatus.allHealthy ? 'Nodes unhealthy' :
                       syncStatus.gl0?.fork ? 'GL0 fork detected' :
                       syncStatus.ml0?.fork ? 'ML0 fork detected' :
                       'Unknown';
        console.log(`⏸️  Skipping generation - network not ready: ${reason}`);
        return;
      }
    } catch (e) {
      console.log(`⏸️  Skipping generation - sync check failed: ${e}`);
      return;
    }
    
    // Run orchestrator tick
    try {
      const result = await orchestrator.tick();
      
      if (result.skipped) {
        console.log(`Generation ${generation}: ⏸️  Skipped (network not ready)`);
        return;
      }
      
      const stats = orchestrator.getStats();
      console.log(`Generation ${generation}:`);
      console.log(`  Active: ${stats.activeFibers} | Created: ${result.created} | Driven: ${result.driven} | Completed: ${result.completed}`);
      if (result.rejected > 0 || result.pending > 0 || stats.failedFibers > 0) {
        console.log(`  Rejected: ${result.rejected} | Pending: ${result.pending} | Total Failed: ${stats.failedFibers}`);
      }
      console.log(`  Distribution: ${JSON.stringify(stats.fiberTypeDistribution)}`);
    } catch (e) {
      console.error(`❌ Tick error: ${e}`);
    }
  }, config.generationIntervalMs);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📊 Shutting down...');
    clearInterval(interval);
    const stats = orchestrator.getStats();
    console.log(`Final: ${stats.activeFibers} active, ${stats.completedFibers} completed`);
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  // Start status server for monitoring
  const statusPort = parseInt(process.env.STATUS_PORT ?? '3033', 10);
  const startedAt = new Date().toISOString();
  let currentMode: TrafficGenStatus['mode'] = 'idle';
  let simulatorRef: Simulator | null = null;
  
  await startStatusServer(statusPort);
  
  // Check for weighted mode
  const isWeighted = 
    process.argv.includes('--weighted') ||
    process.argv.includes('-W') ||
    process.env.MODE === 'weighted';
  
  if (isWeighted) {
    currentMode = 'orchestrator';
    // TODO: Wire up orchestrator status provider
    return runWeightedOrchestrator();
  }
  
  // Check for high-throughput mode
  const isHighThroughput = 
    process.argv.includes('--high-throughput') ||
    process.argv.includes('-H') ||
    process.env.MODE === 'high-throughput';
  
  if (isHighThroughput) {
    currentMode = 'high-throughput';
    const targetTps = parseInt(process.env.TARGET_TPS ?? '10', 10);
    const targetPopulation = parseInt(process.env.TARGET_POPULATION ?? '1000', 10);
    
    // Set up high-throughput status provider
    setStatusProvider(() => ({
      enabled: true,
      mode: 'high-throughput',
      targetTps,
      targetPopulation,
      currentPopulation: 0, // TODO: Wire up from HighThroughputSimulator
      currentTps: 0,
      generation: 0,
      totalTransactions: 0,
      successRate: 0,
      uptime: Date.now() - new Date(startedAt).getTime(),
      startedAt,
    }));
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(' OttoChain HIGH-THROUGHPUT Traffic Generator');
    console.log('═══════════════════════════════════════════════════════════════');
    return runHighThroughput();
  }
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Evolutionary Traffic Generator');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' (Use --high-throughput for 1000 agents / 10 TPS mode)');
  console.log(' (Use --wallets <path> for persistent wallet pool)');
  
  const config = loadConfig();
  
  console.log(`   Target population: ${config.targetPopulation}`);
  console.log(`   Generation interval: ${config.generationIntervalMs}ms`);
  console.log(`   Bridge: ${config.bridgeUrl}`);
  console.log(`   ML0: ${config.ml0Url}`);
  if (config.walletPoolPath) {
    console.log(`   Wallet pool: ${config.walletPoolPath}`);
  }
  
  const simulator = new Simulator(config, {
    onGenerationStart: (gen) => {
      process.stdout.write(`\n🧬 Generation ${gen}...`);
    },
    
    onGenerationEnd: (stats) => {
      console.log(`\n${formatStats(stats)}`);
    },
    
    onAgentBirth: (agent) => {
      console.log(`  🌱 Birth: ${agent.meta.displayName} (${agent.meta.platform})`);
    },
    
    onAgentDeath: (agent) => {
      console.log(`  💀 Death: ${agent.meta.displayName}`);
    },
    
    onError: (error, context) => {
      console.error(`  ⚠️  Error in ${context}: ${error.message}`);
    },
  });
  
  // Set up standard mode status provider
  simulatorRef = simulator;
  setStatusProvider(() => {
    const stats = simulator.getStats();
    const totalTx = stats.totalTransactions ?? 0;
    const successTx = stats.successfulTransactions ?? totalTx;
    return {
      enabled: true,
      mode: 'standard',
      targetTps: Math.round(1000 / config.generationIntervalMs), // Approximate
      targetPopulation: config.targetPopulation,
      currentPopulation: stats.population,
      currentTps: 0, // Standard mode doesn't track TPS directly
      generation: stats.generation,
      totalTransactions: totalTx,
      successRate: totalTx > 0 ? successTx / totalTx : 1,
      uptime: Date.now() - new Date(startedAt).getTime(),
      startedAt,
    };
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n📊 Shutting down...');
    simulator.stop();
    
    const stats = simulator.getStats();
    console.log(`Final state:`);
    console.log(`  Generations: ${stats.generation}`);
    console.log(`  Population: ${stats.population}`);
    console.log(`  Active contracts: ${stats.activeContracts}`);
    console.log(`  Active markets: ${stats.activeMarkets}`);
    console.log(`  Average fitness: ${stats.avgFitness.toFixed(3)}`);
    
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    simulator.stop();
    process.exit(0);
  });
  
  // Start simulation
  await simulator.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Re-export for programmatic use
export { Simulator } from './simulator.js';
export { HighThroughputSimulator, runHighThroughput } from './high-throughput.js';
export { FiberOrchestrator } from './orchestrator.js';
export { BridgeClient } from './bridge-client.js';
export * from './types.js';
export * from './selection.js';
export * from './workflows.js';
export * from './wallets.js';
export * from './fiber-definitions.js';
export * from './market-workflows.js';
export * from './status-server.js';
