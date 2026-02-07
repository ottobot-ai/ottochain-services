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
    const availableAgents = this.getAvailableAgents();
    
    for (const role of def.roles) {
      const agent = availableAgents.find(a => !this.isAgentInFiber(a.address));
      if (!agent) {
        throw new Error(`Not enough agents available for role ${role} in fiber ${type}`);
      }
      participants.set(role, {
        address: agent.address,
        privateKey: agent.privateKey
      });
    }

    // Create fiber via bridge
    // Note: This is a simplified placeholder - actual implementation
    // would need to construct proper fiber definition and initial data
    const createResult = await this.bridge.createFiber(
      participants.get(def.roles[0])!.privateKey,
      { type },
      { state: 'proposed' }
    );

    // Add to active fibers
    this.activeFibers.push({
      id: createResult.fiberId,
      type,
      participants,
      currentState: 'proposed',
      startedAt: Date.now()
    });
  }

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
