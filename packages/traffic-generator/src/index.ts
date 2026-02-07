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
import { DEFAULT_CONFIG } from './types.js';
import { Simulator } from './simulator.js';
import { HighThroughputSimulator, runHighThroughput } from './high-throughput.js';
import { FiberOrchestrator, TrafficConfig } from './orchestrator.js';
import { BridgeClient } from './bridge-client.js';
import { loadWalletPool, type WalletPool } from './wallets.js';

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
  const defaultWeights: Record<string, number> = {
    escrow: 0.25,
    arbitratedEscrow: 0.15,
    ticTacToe: 0.20,
    simpleOrder: 0.15,
    voting: 0.10,
    approval: 0.15,
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
  
  return {
    generationIntervalMs: parseInt(process.env.GENERATION_INTERVAL_MS ?? '30000', 10),
    targetActiveFibers: parseInt(process.env.TARGET_ACTIVE_FIBERS ?? '20', 10),
    fiberWeights,
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
    state: w.agentId ? 'REGISTERED' : 'UNREGISTERED',
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
  // Check for weighted mode
  const isWeighted = 
    process.argv.includes('--weighted') ||
    process.argv.includes('-W') ||
    process.env.MODE === 'weighted';
  
  if (isWeighted) {
    return runWeightedOrchestrator();
  }
  
  // Check for high-throughput mode
  const isHighThroughput = 
    process.argv.includes('--high-throughput') ||
    process.argv.includes('-H') ||
    process.env.MODE === 'high-throughput';
  
  if (isHighThroughput) {
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
