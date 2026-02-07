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
import type { GeneratorConfig, GenerationStats } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { Simulator } from './simulator.js';
import { HighThroughputSimulator, runHighThroughput } from './high-throughput.js';

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
    monitorUrl: process.env.MONITOR_URL,
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
    `  Mutations: ${stats.mutations}`,
    `  Fitness: avg=${stats.avgFitness.toFixed(3)}, max=${stats.maxFitness.toFixed(3)}`,
  ];
  return lines.join('\n');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
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
export { BridgeClient } from './bridge-client.js';
export * from './types.js';
export * from './selection.js';
export * from './workflows.js';
export * from './wallets.js';
