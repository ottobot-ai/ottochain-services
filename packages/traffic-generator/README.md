# @ottochain/traffic-generator

Evolutionary traffic generator for the OttoChain metagraph.

## Overview

This package implements a genetic algorithm-inspired simulation framework for generating continuous, realistic traffic on the OttoChain metagraph. It models agent populations with fitness-based selection, contract negotiations, and evolutionary dynamics.

## Key Concepts

### Evolutionary Model

| Concept | State Machine Mapping |
|---------|----------------------|
| **Fitness** | Reputation score + completion rate + network effect + age |
| **Selection** | High-fitness agents get more activity (roulette wheel) |
| **Crossover** | Agents who complete contracts build network connections |
| **Mutation** | Random path choices (reject instead of accept, dispute) |
| **Generations** | Time epochs with population snapshots |

### Agent Fitness

```typescript
interface AgentFitness {
  reputation: number;    // From on-chain state (40% weight)
  completionRate: number; // Contracts completed / proposed (25% weight)
  networkEffect: number;  // Connections to high-rep agents (20% weight)
  age: number;           // Survival bonus (15% weight)
}
```

### Selection Mechanisms

1. **Roulette Wheel Selection** — Agents are selected for activity proportional to their fitness
2. **Softmax Transition Selection** — Transition paths are chosen with temperature-controlled randomness
3. **Inverse Fitness Death Selection** — Low-fitness agents are more likely to withdraw

### Temperature Annealing

The `temperature` parameter controls exploration vs exploitation:
- **High temp (>1)**: More random choices, exploring unexpected paths
- **Low temp (<1)**: More deterministic, following optimal paths
- Temperature decays each generation (default 0.995 decay)

## Installation

```bash
pnpm install
```

## Usage

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_URL` | `http://localhost:3030` | Bridge service URL |
| `ML0_URL` | `http://localhost:9200` | Metagraph L0 URL |
| `TARGET_POPULATION` | `20` | Target number of agents |
| `BIRTH_RATE` | `2` | New agents per generation |
| `DEATH_RATE` | `0.05` | Fraction of population that withdraws |
| `ACTIVITY_RATE` | `0.4` | Fraction of population active per generation |
| `PROPOSAL_RATE` | `0.3` | Contract proposals per active agent |
| `MUTATION_RATE` | `0.1` | Probability of unexpected transitions |
| `GENERATION_INTERVAL_MS` | `10000` | Milliseconds between generations |
| `MAX_GENERATIONS` | `0` | Max generations (0 = infinite) |
| `PLATFORMS` | `discord,telegram,twitter,github` | Comma-separated platforms |
| `SEED` | (random) | Seed for reproducible runs |

### Running

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start

# With custom config
BRIDGE_URL=http://5.78.90.207:3030 \
ML0_URL=http://5.78.90.207:9200 \
TARGET_POPULATION=50 \
GENERATION_INTERVAL_MS=5000 \
pnpm dev
```

### Docker

```bash
docker build -t ottochain-traffic-generator .
docker run -e BRIDGE_URL=http://host:3030 -e ML0_URL=http://host:9200 ottochain-traffic-generator
```

## Programmatic Usage

```typescript
import { Simulator, type GeneratorConfig } from '@ottochain/traffic-generator';

const config: Partial<GeneratorConfig> = {
  targetPopulation: 10,
  generationIntervalMs: 5000,
  bridgeUrl: 'http://localhost:3030',
  ml0Url: 'http://localhost:9200',
};

const simulator = new Simulator(config, {
  onGenerationEnd: (stats) => {
    console.log(`Gen ${stats.generation}: ${stats.successes}/${stats.transactions} txns`);
  },
});

await simulator.start();

// Later...
simulator.stop();
```

## Generation Flow

Each generation:

1. **Population Dynamics**
   - Create new agents if below target (births)
   - Select low-fitness agents for withdrawal (deaths)

2. **Agent Activity**
   - Select active agents via fitness-weighted roulette
   - Each agent chooses transitions via softmax selection
   - Execute transitions on the metagraph

3. **Contract Lifecycle**
   - Propose new contracts (fitness-weighted counterparty selection)
   - Accept/reject pending proposals
   - Complete/dispute active contracts at expected completion time

4. **Fitness Updates**
   - Update all agent fitness scores
   - Decay temperature
   - Adjust market health based on success rate

## Output

```
═══════════════════════════════════════════════════════════════
 OttoChain Evolutionary Traffic Generator
═══════════════════════════════════════════════════════════════
🧬 Starting evolutionary traffic simulator
   Target population: 20
   Generation interval: 10000ms
   Bridge: http://localhost:3030
   ML0: http://localhost:9200
   Bootstrapping 10 initial agents...
   ✓ Created 10/10 agents

🧬 Generation 1...
Generation 1 @ 2026-02-04T21:30:00.000Z
  Population: 12 (births: 2, deaths: 0)
  Transactions: 15/18 (3 failed)
  Contracts: 2 completed, 1 rejected, 0 disputed
  Mutations: 2
  Fitness: avg=0.423, max=0.612
```

## License

Apache-2.0
