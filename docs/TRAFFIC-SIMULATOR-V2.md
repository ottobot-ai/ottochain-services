# Traffic Simulator V2 — Design Document

## Overview

A persistent, autonomous traffic simulator for OttoChain that:
1. Maintains a stable population of funded agents across restarts
2. Evolves fiber selection strategies based on success metrics
3. Exercises both the **Fiber system** (state machines) and **Identity app** (reputation/attestations)
4. Self-heals when infrastructure issues arise

---

## Current State (V1)

### What Works
- Genetic algorithm skeleton (tournament selection, crossover, mutation)
- 7 workflow types defined
- Agent creation through bridge API
- Basic fitness function

### What Doesn't Work
- **No persistence**: Creates new agents every restart (5,348 REGISTERED zombies in DB)
- **No wallet reuse**: Can't pre-fund in genesis.csv
- **Contracts never complete**: 0% completion rate across all generations
- **No identity exploration**: Doesn't test attestations, reputation queries, or trust graphs
- **Fragile**: Crashes on bridge timeouts, no backoff/retry

---

## V2 Architecture

### 1. Wallet Persistence Layer

```
┌─────────────────────────────────────────────────────────┐
│                    wallets.json                         │
│  Persisted to disk, loaded on startup                   │
├─────────────────────────────────────────────────────────┤
│ {                                                       │
│   "agents": [                                           │
│     {                                                   │
│       "id": "agent_001",                                │
│       "address": "DAG...",                              │
│       "publicKey": "...",                               │
│       "privateKey": "...",  // encrypted at rest        │
│       "platform": "twitter",                            │
│       "traits": { ... },                                │
│       "stats": { ... }                                  │
│     }                                                   │
│   ],                                                    │
│   "genesisExport": "genesis-agents.csv"                 │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

**Genesis Integration:**
```bash
# Generate wallets once
traffic-gen wallet generate --count 200 --output wallets.json

# Export for genesis.csv
traffic-gen wallet export-genesis --input wallets.json --output genesis-agents.csv

# Append to deploy genesis
cat genesis-agents.csv >> ottochain-deploy/genesis.csv
```

**Wallet Lifecycle:**
1. `generate` — Create keypairs, store encrypted
2. `export-genesis` — Output `address,balance` CSV for ML0 genesis
3. `register` — Register with bridge (creates identity, links wallet)
4. `fund` — Top-up via faucet or transfer (post-genesis)

### 2. Bridge Wallet Clarification

The bridge already manages:
- **Custody wallets**: For escrow, fees, rewards
- **Agent identity ↔ wallet binding**: Links DAG address to platform identity

What traffic-gen needs to do differently:
- **Pre-generate wallets** instead of letting bridge create them
- **Pass existing keypair** during registration
- **Store mapping** for reuse across restarts

```typescript
// Current (V1) - bridge creates wallet
POST /agents/register
{ platform: "twitter", handle: "agent_001" }
// Returns: { agentId, address, privateKey }

// Proposed (V2) - bring your own wallet
POST /agents/register
{ 
  platform: "twitter", 
  handle: "agent_001",
  wallet: {
    address: "DAG...",
    publicKey: "..."
  },
  signature: "..." // proves ownership
}
```

### 3. Fiber Evolution System

#### Fiber Types to Exercise

| Fiber Type | Complexity | Actors | Tests |
|------------|------------|--------|-------|
| **SimpleOrder** | Low | 2 | Basic state transitions |
| **TicTacToe** | Medium | 2 | Turn-based, win/draw/timeout |
| **TokenEscrow** | Medium | 2-3 | Deposit → Release/Refund |
| **Contract** | High | 2+ | Offer → Accept → Complete/Dispute |
| **Voting** | High | N | Propose → Vote → Tally |
| **ApprovalWorkflow** | High | N | Multi-sig, quorum rules |
| **Auction** | High | N | Bids, time windows, settlement |

#### Evolution Strategy

**Per-Agent Traits** (heritable, mutable):
```typescript
interface AgentTraits {
  // Fiber preferences (sum to 1.0)
  fiberWeights: {
    SimpleOrder: number;
    TicTacToe: number;
    TokenEscrow: number;
    Contract: number;
    Voting: number;
    ApprovalWorkflow: number;
  };
  
  // Behavioral traits
  activityLevel: number;      // 0-1: how often to initiate
  riskTolerance: number;      // 0-1: accept risky counterparties?
  cooperativeness: number;    // 0-1: complete vs dispute tendency
  responseSpeed: number;      // 0-1: how fast to respond to pending
}
```

**Fitness Function (revised):**
```typescript
function calculateFitness(agent: Agent): number {
  const weights = {
    completionRate: 0.30,    // % of fibers completed successfully
    reputation: 0.25,        // on-chain reputation score
    earnings: 0.20,          // net token balance change
    networkEffect: 0.15,     // unique counterparties
    diversity: 0.10          // variety of fiber types attempted
  };
  
  return (
    agent.stats.completionRate * weights.completionRate +
    normalize(agent.reputation) * weights.reputation +
    normalize(agent.earnings) * weights.earnings +
    normalize(agent.uniqueCounterparties) * weights.networkEffect +
    agent.stats.fiberDiversity * weights.diversity
  );
}
```

**Selection Pressure:**
- Top 20% reproduce (crossover traits)
- Middle 60% survive unchanged
- Bottom 20% get trait mutations (exploration)
- Worst 5% replaced by new random agents (diversity injection)

#### Fiber Completion Loop

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   INITIATE  │────▶│   PENDING   │────▶│  COMPLETE   │
│  (create)   │     │  (waiting)  │     │  (success)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   TIMEOUT   │
                   │  (failure)  │
                   └─────────────┘
```

**Missing piece**: The simulator needs to **drive both sides** of a fiber:
1. Agent A initiates (e.g., creates contract offer)
2. Agent B accepts/responds (currently not happening!)
3. Continue until terminal state

V1 only does step 1. V2 must poll for pending fibers and have agents respond.

### 4. Identity App Exploration

The Identity module has features not being tested:

#### Registration Flow
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   REGISTER   │────▶│   ACTIVATE   │────▶│    ACTIVE    │
│  (pending)   │     │  (on-chain)  │     │  (usable)    │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Current coverage**: ✅ Registration, ⚠️ Activation (flaky), ❌ Post-activation

#### Attestation System (UNTESTED)
```typescript
// Self-attestation
POST /agents/{id}/attestations
{ type: "skill", claim: "solidity-developer", evidence: "..." }

// Peer attestation (vouching)
POST /agents/{id}/attestations
{ type: "vouch", from: "agent_002", claim: "trustworthy", weight: 0.8 }

// Verification attestation (external oracle)
POST /agents/{id}/attestations
{ type: "verification", provider: "twitter", proof: "..." }
```

**Evolution integration**: Agents with more attestations should have higher fitness.

#### Reputation Queries (UNTESTED)
```typescript
// Get agent reputation
GET /agents/{id}/reputation
// Returns: { score: 0.85, attestations: 12, completedFibers: 47 }

// Get trust graph
GET /agents/{id}/trust-graph?depth=2
// Returns: network of vouches/attestations
```

**Evolution integration**: Use reputation API to inform counterparty selection.

#### Identity Test Scenarios

| Scenario | Description | Fitness Impact |
|----------|-------------|----------------|
| **Self-Attest** | Add skills/claims | +0.02 per attestation |
| **Vouch** | Attest for another agent | +0.01 (network building) |
| **Get Vouched** | Receive attestation | +0.03 (trust signal) |
| **Verify** | Complete platform verification | +0.05 (strong signal) |
| **Query Rep** | Check counterparty before fiber | Avoid bad actors |

### 5. Autonomous Operation

#### Self-Healing Behaviors

```typescript
interface HealthMonitor {
  // Circuit breaker for bridge
  bridgeHealth: {
    consecutiveFailures: number;
    backoffMs: number;
    maxBackoff: 60000;
  };
  
  // Metagraph health
  ml0Health: {
    lastSnapshotOrdinal: number;
    snapshotLag: number;
    isProducing: boolean;
  };
}

// Backoff strategy
function getBackoff(failures: number): number {
  return Math.min(1000 * Math.pow(2, failures), 60000);
}
```

#### Persistence & Recovery

```typescript
interface SimulatorState {
  generation: number;
  population: Agent[];
  stats: GenerationStats[];
  lastCheckpoint: Date;
}

// Save every N generations
function checkpoint(state: SimulatorState): void {
  writeFileSync('simulator-state.json', JSON.stringify(state));
}

// Recover on startup
function recover(): SimulatorState | null {
  if (existsSync('simulator-state.json')) {
    return JSON.parse(readFileSync('simulator-state.json'));
  }
  return null;
}
```

#### Metrics & Observability

Export Prometheus metrics:
```
# Population
traffic_simulator_population_size{} 150
traffic_simulator_generation{} 42

# Fitness
traffic_simulator_fitness_avg{} 0.45
traffic_simulator_fitness_max{} 0.82
traffic_simulator_fitness_min{} 0.12

# Fibers
traffic_simulator_fibers_initiated{type="Contract"} 234
traffic_simulator_fibers_completed{type="Contract"} 189
traffic_simulator_fibers_failed{type="Contract"} 45

# Identity
traffic_simulator_attestations_created{} 567
traffic_simulator_reputation_queries{} 890

# Health
traffic_simulator_bridge_failures{} 3
traffic_simulator_bridge_backoff_ms{} 4000
```

---

## Implementation Plan

### Phase 1: Wallet Persistence (Day 1)
- [ ] Add `wallets.json` schema and encryption
- [ ] `generate` command to create wallet pool
- [ ] `export-genesis` command for deploy integration
- [ ] Modify registration to use existing wallets
- [ ] Load wallets on startup, skip registration for known agents

### Phase 2: Fiber Completion (Day 2)
- [ ] Add "pending fiber" polling loop
- [ ] Implement response logic for each fiber type
- [ ] Track fiber state transitions end-to-end
- [ ] Fix the 0% completion rate issue

### Phase 3: Identity Exploration (Day 3)
- [ ] Add attestation creation (self, peer, verification)
- [ ] Add reputation queries before counterparty selection
- [ ] Integrate attestation count into fitness
- [ ] Test trust graph queries

### Phase 4: Evolution Improvements (Day 4)
- [ ] Implement revised fitness function
- [ ] Add fiber-type-specific traits
- [ ] Add diversity injection
- [ ] Add adaptive mutation rates

### Phase 5: Autonomous Operation (Day 5)
- [ ] Add circuit breaker for bridge
- [ ] Add checkpoint/recovery
- [ ] Add Prometheus metrics
- [ ] Add health dashboard endpoint

---

## Open Questions

1. **Wallet encryption**: Use what key? Derive from bridge secret?
2. **Genesis timing**: How to coordinate wallet generation with deploy scripts?
3. **Funding amounts**: How much to give each agent? (Suggest: 1000 OTTO each)
4. **Attestation validity**: Should simulator attestations be distinguishable from real ones?
5. **Multi-instance**: Can we run multiple simulators against same metagraph?

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Fiber completion rate | 0% | >80% |
| Agent reuse across restarts | 0% | 100% |
| Attestations per agent | 0 | 3-5 |
| Mean fitness score | 0.12 | 0.50+ |
| Uptime without crash | ~10 min | 24h+ |
| Generations per day | ~50 | 1000+ |

---

*Document: TRAFFIC-SIMULATOR-V2.md*  
*Author: OttoBot*  
*Date: 2026-02-06*  
*Status: Draft*
