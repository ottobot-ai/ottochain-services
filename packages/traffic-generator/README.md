# @ottochain/traffic-generator

Evolutionary traffic generator for the OttoChain metagraph.

## Overview

This package implements a genetic algorithm-inspired simulation framework for generating continuous, realistic traffic on the OttoChain metagraph. It models agent populations with fitness-based selection, multiple workflow types, and evolutionary dynamics.

**Two modes:**
- **Standard mode**: Moderate load (~20 agents, ~2 TPS) for development/testing
- **High-throughput mode**: Heavy load (1000 agents, 10+ TPS, 7 workflow types) for stress testing indexer/explorer

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

#### Indexer Verification (Optional)

When enabled, the traffic generator waits for each transition to be indexed before proceeding,
and checks for ML0 rejections. This ensures the test accurately reflects on-chain state.

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXER_VERIFY` | `false` | Enable indexer verification (`true` to enable) |
| `INDEXER_URL` | `http://localhost:3031` | Indexer service URL (enables verification if set) |
| `INDEXER_WAIT_TIMEOUT` | `30000` | Max ms to wait for indexer confirmation |
| `INDEXER_POLL_INTERVAL` | `2000` | Poll interval when waiting for indexer |
| `INDEXER_MAX_RETRIES` | `3` | Max retries on timeout before marking fiber as failed |
| `INDEXER_SKIP_ON_REJECTION` | `true` | Remove fiber on rejection (vs keep trying) |

**Example with indexer verification:**
```bash
INDEXER_URL=http://localhost:3031 \
INDEXER_WAIT_TIMEOUT=60000 \
BRIDGE_URL=http://localhost:3030 \
pnpm dev -- --weighted
```

### Running

```bash
# Standard mode (development)
pnpm dev

# High-throughput mode (1000 agents, 10 TPS, all workflows)
pnpm dev -- --high-throughput

# Or via environment
MODE=high-throughput TARGET_POPULATION=1000 TARGET_TPS=10 pnpm dev

# Production
pnpm build && pnpm start

# Custom testnet config
BRIDGE_URL=http://5.78.90.207:3030 \
ML0_URL=http://5.78.90.207:9200 \
TARGET_POPULATION=500 \
TARGET_TPS=15 \
pnpm dev -- --high-throughput
```

## Integration Tests

Standalone end-to-end tests that exercise fiber lifecycles against a real cluster.
Each test creates its own wallets and fibers, uses the Indexer as source of truth,
and asserts no critical rejections after every transition.

| Test file | Fiber type | States covered |
|-----------|-----------|----------------|
| `test/integration.test.ts` | AgentIdentity | REGISTERED → ACTIVE |
| `test/contract-integration.test.ts` | Contract | PROPOSED → ACTIVE → COMPLETED / REJECTED |
| `test/voting-integration.test.ts` | Voting | PROPOSED → VOTING → PASSED |
| `test/token-escrow.integration.test.ts` | TokenEscrow | PROPOSED → FUNDED → ACTIVE → COMPLETED / CANCELLED |

```bash
# Run a specific integration test (requires a running cluster)
BRIDGE_URL=http://localhost:3030 INDEXER_URL=http://localhost:3031 \
  npx tsx test/token-escrow.integration.test.ts

# Environment variables
FIBER_WAIT_TIMEOUT=30   # Max seconds waiting for indexer to confirm each state
DL1_SYNC_WAIT=10        # Seconds to wait after fiber creation for DL1 sync
TRANSITION_WAIT=5       # Seconds to wait between transitions
```

The TokenEscrow test covers four suites:
- **Suite A** – Happy path: PROPOSED → FUNDED → ACTIVE → (mint/transfer/burn) → COMPLETED
- **Suite B** – Cancel from PROPOSED
- **Suite C** – Cancel from FUNDED
- **Suite D** – Cancel from ACTIVE

## Workflow Types

The high-throughput mode supports 7 workflow types:

| Workflow | Participants | States | Expected Duration |
|----------|--------------|--------|-------------------|
| **AgentIdentity** | 1 | Registered → Active → Withdrawn | 50 gens |
| **Contract** | 2 | Proposed → Active → Completed/Rejected | 10 gens |
| **Voting** | 3-20 | Pending → Voting → Completed | 8 gens |
| **TokenEscrow** | 2-3 | Pending → Funded → Released/Refunded | 6 gens |
| **TicTacToe** | 2 | Setup → Playing → Finished | 12 gens |
| **SimpleOrder** | 2 | Created → Confirmed → Shipped → Delivered | 8 gens |
| **ApprovalWorkflow** | 3-5 | Draft → Submitted → L1 → L2 → Approved | 10 gens |

### Workflow Transitions

Each workflow defines weighted transitions:

```typescript
// Contract example
{ from: 'Proposed', to: 'Active', event: 'accept', actor: 'counterparty', weight: 0.7 }
{ from: 'Proposed', to: 'Rejected', event: 'reject', actor: 'counterparty', weight: 0.3 }
{ from: 'Active', to: 'Completed', event: 'complete', actor: 'owner', weight: 0.85 }
{ from: 'Active', to: 'Disputed', event: 'dispute', actor: 'any', weight: 0.15 }
```

The mutation rate (default 8%) causes occasional unexpected transitions (e.g., accepting a contract that would normally be rejected) to simulate organic behavior.

## High-Throughput Mode

Designed for stress testing the indexer and explorer:

```bash
# Environment variables for high-throughput
TARGET_POPULATION=1000    # Number of agents
TARGET_TPS=10             # Target transactions per second
BATCH_SIZE=20             # Parallel transaction submissions
MAX_FIBERS_PER_TYPE=500   # Max concurrent fibers per workflow
GENERATION_INTERVAL_MS=1000  # 1 second generations
WORKFLOWS=AgentIdentity,Contract,Voting,TokenEscrow,TicTacToe,SimpleOrder,ApprovalWorkflow
```

### Output (High-Throughput)

```
🚀 Starting high-throughput traffic generator
   Target: 10 TPS
   Population: 1000 agents
   Batch size: 20
   Workflows: AgentIdentity, Contract, Voting, TokenEscrow, TicTacToe, SimpleOrder, ApprovalWorkflow
   Bridge: http://localhost:3030
   Bootstrapping 1000 agents in 20 batches...
   Created 1000/1000 agents
   ✓ Bootstrap complete

[Gen 15] TPS: 12.4 | Tx: 186/200 | Fibers: 847 (Contract:312 Voting:89 TokenEscrow:156 ...) | Agents: 1000
[Gen 20] TPS: 11.2 | Tx: 242/260 | Fibers: 923 (Contract:345 Voting:102 TokenEscrow:178 ...) | Agents: 1000
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
