import { BridgeClient } from './bridge-client.js';
import { FIBER_DEFINITIONS } from './fiber-definitions.js';
import { Agent } from './types.js';

export interface TrafficConfig {
  generationIntervalMs: number;
  targetActiveFibers: number;
  fiberWeights: Record<string, number>;
}

export interface ActiveFiber {
  id: string;
  type: string;
  participants: Map<string, { address: string; privateKey: string }>;
  currentState: string;
  startedAt: number;
}

export interface TickResult {
  newFibers: number;
  drivenFibers: number;
  completedFibers: number;
}

/**
 * FiberOrchestrator
 * 
 * Manages the creation and progression of fibers according to a configurable traffic mix.
 * Drives all parties in a fiber to completion.
 */
export class FiberOrchestrator {
  private activeFibers: ActiveFiber[] = [];
  private completedFibers: number = 0;

  constructor(
    private config: TrafficConfig,
    private bridge: BridgeClient,
    private getAvailableAgents: () => Agent[]
  ) {}

  /**
   * Main orchestration loop tick
   * - Drives existing fibers forward
   * - Starts new fibers if below target
   */
  async tick(): Promise<TickResult> {
    this.tickCount++;
    let newFibers = 0;
    let drivenFibers = 0;
    let completedFibers = 0;

    // Drive existing fibers forward (placeholder for actual logic)
    for (const fiber of this.activeFibers) {
      // TODO: Implement actual fiber progression logic
      // This would involve:
      // 1. Determining next transition for this fiber
      // 2. Identifying the actor (agent) for that transition
      // 3. Calling bridge.transitionFiber() for that actor
      drivenFibers++;
    }

    // Start new fibers if needed
    const currentActive = this.activeFibers.length;
    if (currentActive < this.config.targetActiveFibers) {
      const fibersToStart = this.config.targetActiveFibers - currentActive;
      for (let i = 0; i < fibersToStart; i++) {
        const fiberType = this.selectFiberType();
        await this.startFiber(fiberType);
        newFibers++;
      }
    }

    return {
      newFibers,
      drivenFibers,
      completedFibers
    };
  }

  /**
   * Weighted random selection of fiber type based on config.fiberWeights
   */
  private selectFiberType(): string {
    const totalWeight = Object.values(this.config.fiberWeights).reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const [type, weight] of Object.entries(this.config.fiberWeights)) {
      random -= weight;
      if (random <= 0) {
        return type;
      }
    }
    
    // Fallback (should not happen if weights sum to 1.0)
    return 'escrow';
  }

  /**
   * Start a new fiber of the given type
   */
  private async startFiber(type: string): Promise<void> {
    const def = FIBER_DEFINITIONS[type];
    if (!def) {
      throw new Error(`Unknown fiber type: ${type}`);
    }

    // Recruit agents for each role
    const participants = new Map<string, { address: string; privateKey: string }>();
    const participantAddresses = new Map<string, string>(); // role -> address for stateData
    const availableAgents = this.getAvailableAgents();
    const usedAddresses = new Set<string>();
    
    for (const role of def.roles) {
      const agent = availableAgents.find(a => 
        !this.isAgentInFiber(a.address) && !usedAddresses.has(a.address)
      );
      if (!agent) {
        console.log(`⚠️  Not enough agents for ${type} (need ${def.roles.length}, missing ${role})`);
        return; // Skip this fiber, don't throw
      }
      participants.set(role, {
        address: agent.address,
        privateKey: agent.privateKey
      });
      participantAddresses.set(role, agent.address);
      usedAddresses.add(agent.address);
    }

    // Generate a temporary fiber ID for stateData generation
    const tempFiberId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Generate proper stateData using the definition's generator
    const stateData = def.generateStateData(participantAddresses, {
      fiberId: tempFiberId,
      generation: this.tickCount,
    });

    // Create fiber via bridge with proper workflowType and stateData
    const proposer = participants.get(def.roles[0])!;
    
    try {
      const createResult = await this.bridge.createFiber(
        proposer.privateKey,
        {
          workflowType: def.workflowType,
          type: def.type,
          name: def.name,
          initialState: def.initialState,
          states: def.states,
          // Include basic transition definitions
          transitions: def.transitions.map(t => ({
            from: t.from,
            to: t.to,
            event: t.event,
          })),
        },
        stateData as Record<string, unknown>
      );

      // Add to active fibers
      this.activeFibers.push({
        id: createResult.fiberId,
        type,
        participants,
        currentState: def.initialState,
        startedAt: Date.now(),
      });

      console.log(`  ✅ Created ${def.name}: ${createResult.fiberId.slice(0, 12)}...`);
    } catch (err) {
      console.log(`  ❌ Failed to create ${def.name}: ${(err as Error).message}`);
    }
  }

  private tickCount = 0;

  /**
   * Check if an agent is currently participating in any fiber
   */
  private isAgentInFiber(address: string): boolean {
    return this.activeFibers.some(fiber => 
      Array.from(fiber.participants.values()).some(agent => agent.address === address)
    );
  }

  /**
   * Get current statistics
   */
  getStats(): {
    activeFibers: number;
    completedFibers: number;
    fiberTypeDistribution: Record<string, number>;
  } {
    const distribution: Record<string, number> = {};
    for (const [type, _] of Object.entries(this.config.fiberWeights)) {
      distribution[type] = 0;
    }
    
    for (const fiber of this.activeFibers) {
      distribution[fiber.type] = (distribution[fiber.type] || 0) + 1;
    }

    return {
      activeFibers: this.activeFibers.length,
      completedFibers: this.completedFibers,
      fiberTypeDistribution: distribution
    };
  }
}
