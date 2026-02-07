# Traffic Generator Refactor Spec

## Goal

Replace genetic algorithm with **configurable weighted selection** for traffic generation. Make fiber type distribution explicit, predictable, and tunable via config.

## Current Problems

1. **GA is overkill** — fitness/evolution adds complexity without clear benefit for traffic generation
2. **No explicit fiber type control** — can't say "run 30% escrow, 20% tic-tac-toe"
3. **Only 2-party interactions** — all fibers are initiator + one counterparty
4. **0% fiber completion** — agents initiate but don't drive counterparty responses

## Desired Behavior

### Config-Driven Traffic Mix

```typescript
interface TrafficConfig {
  // How often to run a generation cycle (ms)
  generationIntervalMs: number;
  
  // Target concurrent active fibers
  targetActiveFibers: number;
  
  // Fiber type weights (must sum to 1.0)
  fiberWeights: {
    escrow: number;           // 2-party: buyer, seller
    arbitratedEscrow: number; // 3-party: buyer, seller, arbiter
    ticTacToe: number;        // 2-party: player1, player2
    simpleOrder: number;      // 2-party: buyer, seller
    voting: number;           // N-party: voters[]
    approval: number;         // 3-party: requester, approver1, approver2
  };
  
  // Participant count distribution (for N-party fibers like voting)
  participantDistribution: {
    min: number;  // e.g., 3
    max: number;  // e.g., 7
  };
}
```

### Example Config

```yaml
traffic:
  generationIntervalMs: 30000
  targetActiveFibers: 50
  
  fiberWeights:
    escrow: 0.25
    arbitratedEscrow: 0.15
    ticTacToe: 0.20
    simpleOrder: 0.15
    voting: 0.10
    approval: 0.15
  
  participantDistribution:
    min: 3
    max: 7
```

## Key Changes

### 1. Remove GA Concepts

**Delete or simplify:**
- `AgentFitness` type and `computeFitness()` function
- `selectForDeath()` — no more evolutionary pressure
- Temperature, mutation rate, market health
- Softmax selection based on fitness

**Keep:**
- Agent registration/lifecycle
- Wallet pool persistence
- Bridge client
- Workflow definitions

### 2. New `FiberOrchestrator` Class

Responsibilities:
- Select fiber type by weight
- Recruit correct number of agents for each role
- Drive fiber to completion (call transitions for ALL parties)
- Track active fibers and completion rates

```typescript
class FiberOrchestrator {
  constructor(
    private config: TrafficConfig,
    private bridge: BridgeClient,
    private agents: AgentPool
  ) {}

  // Main loop: check active fibers, start new ones, drive progress
  async tick(): Promise<void> {
    // 1. Drive existing fibers (call next transition for each)
    await this.driveActiveFibers();
    
    // 2. Start new fibers if below target
    const active = this.getActiveFiberCount();
    if (active < this.config.targetActiveFibers) {
      const fiberType = this.selectFiberType();
      await this.startFiber(fiberType);
    }
  }

  // Weighted random selection
  private selectFiberType(): FiberType {
    const r = Math.random();
    let cumulative = 0;
    for (const [type, weight] of Object.entries(this.config.fiberWeights)) {
      cumulative += weight;
      if (r <= cumulative) return type as FiberType;
    }
    return 'escrow'; // fallback
  }

  // Recruit agents and create fiber
  private async startFiber(type: FiberType): Promise<void> {
    const def = FIBER_DEFINITIONS[type];
    const participants = this.agents.recruit(def.requiredRoles);
    // ... create fiber via bridge
  }

  // Drive ALL parties' transitions (the key fix)
  private async driveActiveFibers(): Promise<void> {
    for (const fiber of this.activeFibers) {
      const nextTransition = this.getNextTransition(fiber);
      if (nextTransition) {
        const actor = this.getActorForTransition(fiber, nextTransition);
        await this.bridge.transition(fiber.id, nextTransition.event, actor);
      }
    }
  }
}
```

### 3. Fiber Definitions with Roles

```typescript
interface FiberDefinition {
  type: string;
  name: string;
  roles: string[];  // e.g., ['buyer', 'seller'] or ['player1', 'player2']
  isVariableParty: boolean;  // true for voting, multi-sig
  transitions: TransitionDef[];
}

const FIBER_DEFINITIONS: Record<string, FiberDefinition> = {
  escrow: {
    type: 'escrow',
    name: 'Simple Escrow',
    roles: ['buyer', 'seller'],
    isVariableParty: false,
    transitions: [
      { from: 'proposed', event: 'accept', actor: 'seller' },
      { from: 'active', event: 'deliver', actor: 'seller' },
      { from: 'delivered', event: 'confirm', actor: 'buyer' },
    ],
  },
  arbitratedEscrow: {
    type: 'arbitratedEscrow',
    name: 'Escrow with Arbiter',
    roles: ['buyer', 'seller', 'arbiter'],
    isVariableParty: false,
    transitions: [
      { from: 'proposed', event: 'accept', actor: 'seller' },
      { from: 'active', event: 'deliver', actor: 'seller' },
      { from: 'delivered', event: 'confirm', actor: 'buyer' },
      { from: 'disputed', event: 'resolve', actor: 'arbiter' },
    ],
  },
  ticTacToe: {
    type: 'ticTacToe',
    name: 'Tic-Tac-Toe Game',
    roles: ['playerX', 'playerO'],
    isVariableParty: false,
    transitions: [
      { from: 'xTurn', event: 'move', actor: 'playerX' },
      { from: 'oTurn', event: 'move', actor: 'playerO' },
      // ... alternates until win/draw
    ],
  },
  voting: {
    type: 'voting',
    name: 'Multi-Party Vote',
    roles: ['proposer', 'voter'],  // voter is variable count
    isVariableParty: true,
    transitions: [
      { from: 'proposed', event: 'vote', actor: 'voter' },  // each voter
      { from: 'voting', event: 'tally', actor: 'proposer' },
    ],
  },
};
```

### 4. Agent Pool (Simplified)

```typescript
class AgentPool {
  private available: Agent[] = [];
  private inFiber: Map<string, Agent> = new Map();

  // Recruit agents for specific roles
  recruit(roles: string[]): Map<string, Agent> {
    const assigned = new Map<string, Agent>();
    for (const role of roles) {
      const agent = this.available.pop();
      if (!agent) throw new Error('Not enough agents');
      assigned.set(role, agent);
      this.inFiber.set(agent.address, agent);
    }
    return assigned;
  }

  // Return agents to pool when fiber completes
  release(agents: Agent[]): void {
    for (const agent of agents) {
      this.inFiber.delete(agent.address);
      this.available.push(agent);
    }
  }
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `types.ts` | Remove GA types (fitness, mutation, temperature). Add `TrafficConfig`, `FiberDefinition`. |
| `simulator.ts` | Replace `Simulator` with `FiberOrchestrator`. Remove fitness/selection logic. |
| `selection.ts` | Delete or gut — no more softmax, fitness computation. |
| `workflows.ts` | Add role definitions, simplify transitions. |
| `index.ts` | Update CLI to use new config format. |

## Success Criteria

1. **Configurable mix**: Running with config produces expected fiber type distribution (±5%)
2. **Multi-party**: 3+ party fibers work (arbitrated escrow, voting)
3. **Completion**: Fibers actually complete (orchestrator drives all parties)
4. **Metrics**: Log shows fiber type distribution, completion rate, active count

## Out of Scope (Future)

- Fuel logistics workflow (needs domain-specific design)
- Complex N-party consensus
- Cross-fiber interactions
- Economic modeling

---

## Instructions for Implementation

Start with these steps in order:

1. **Update `types.ts`**: Add `TrafficConfig` and `FiberDefinition` interfaces. Keep existing types that are still needed.

2. **Create `fiber-definitions.ts`**: Define the fiber templates with roles and transitions.

3. **Create `orchestrator.ts`**: New `FiberOrchestrator` class implementing weighted selection and multi-party driving.

4. **Update `index.ts`**: Wire up new orchestrator, add config loading.

5. **Test**: Verify fiber distribution matches config weights.

Keep the existing `simulator.ts` for reference but don't use it in the new implementation.
