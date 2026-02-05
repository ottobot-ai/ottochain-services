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
 *  - Contract lifecycle (propose, accept, complete, reject, dispute)
 *  - Continuous operation with configurable generation intervals
 * 
 * Usage:
 *   BRIDGE_URL=http://localhost:3030 ML0_URL=http://localhost:9200 npx tsx src/index.ts
 */

import 'dotenv/config';
import type { GeneratorConfig, GenerationStats } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { Simulator } from './simulator.js';

// =============================================================================
// Configuration from Environment
// =============================================================================

function loadConfig(): GeneratorConfig {
  return {
    ...DEFAULT_CONFIG,
    targetPopulation: parseInt(process.env.TARGET_POPULATION ?? '20', 10),
    birthRate: parseInt(process.env.BIRTH_RATE ?? '2', 10),
    deathRate: parseFloat(process.env.DEATH_RATE ?? '0.05'),
    activityRate: parseFloat(process.env.ACTIVITY_RATE ?? '0.4'),
    proposalRate: parseFloat(process.env.PROPOSAL_RATE ?? '0.3'),
    mutationRate: parseFloat(process.env.MUTATION_RATE ?? '0.1'),
    initialTemperature: parseFloat(process.env.INITIAL_TEMPERATURE ?? '1.0'),
    temperatureDecay: parseFloat(process.env.TEMPERATURE_DECAY ?? '0.995'),
    minTemperature: parseFloat(process.env.MIN_TEMPERATURE ?? '0.1'),
    generationIntervalMs: parseInt(process.env.GENERATION_INTERVAL_MS ?? '10000', 10),
    maxGenerations: parseInt(process.env.MAX_GENERATIONS ?? '0', 10),
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
    ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
    platforms: (process.env.PLATFORMS ?? 'discord,telegram,twitter,github').split(','),
    seed: process.env.SEED ? parseInt(process.env.SEED, 10) : undefined,
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
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' OttoChain Evolutionary Traffic Generator');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const config = loadConfig();
  
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
export { BridgeClient } from './bridge-client.js';
export * from './types.js';
export * from './selection.js';
