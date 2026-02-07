import { BridgeClient } from './bridge-client.js';
import { FIBER_DEFINITIONS, type FiberDefinition } from './fiber-definitions.js';
import { Agent } from './types.js';

export interface TrafficConfig {
  generationIntervalMs: number;
  targetActiveFibers: number;
  fiberWeights: Record<string, number>;
}

export interface ActiveFiber {
  id: string;
  type: string;
  definition: FiberDefinition;
  participants: Map<string, { address: string; privateKey: string }>;
  currentState: string;
  /** Index of next transition to execute */
  transitionIndex: number;
  startedAt: number;
}

export interface TickResult {
  skipped: boolean;
  created: number;
  driven: number;
  completed: number;
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
  private registeredAgents: Set<string> = new Set(); // Track registered agent addresses

  constructor(
    private config: TrafficConfig,
    private bridge: BridgeClient,
    private getAvailableAgents: () => Agent[]
  ) {}

  /**
   * Bootstrap: Register agents that don't have identity fibers yet
   * Should be called before starting the main loop
   */
  async bootstrapAgents(count: number = 20): Promise<number> {
    const agents = this.getAvailableAgents();
    let registered = 0;
    
    console.log(`🆔 Bootstrapping agent identities (target: ${count})...`);
    
    for (const agent of agents.slice(0, count)) {
      if (this.registeredAgents.has(agent.address)) continue;
      
      try {
        const result = await this.bridge.registerAgent(
          agent.privateKey,
          `Agent_${agent.address.slice(4, 12)}`,
          'simulation',
          agent.address.slice(0, 16)
        );
        
        // Activate the agent
        await this.bridge.activateAgent(agent.privateKey, result.fiberId);
        
        this.registeredAgents.add(agent.address);
        registered++;
        console.log(`  ✅ Registered: ${agent.address.slice(0, 12)}... (${result.fiberId.slice(0, 8)})`);
      } catch (err) {
        // May already be registered
        const msg = (err as Error).message;
        if (msg.includes('already') || msg.includes('exists')) {
          this.registeredAgents.add(agent.address);
        } else {
          console.log(`  ⚠️  Failed to register ${agent.address.slice(0, 12)}: ${msg.slice(0, 50)}`);
        }
      }
    }
    
    console.log(`  📊 Registered ${registered} new agents (${this.registeredAgents.size} total known)`);
    return registered;
  }

  /**
   * Main orchestration loop tick
   * - Drives existing fibers forward
   * - Starts new fibers if below target
   */
  async tick(): Promise<TickResult> {
    this.tickCount++;
    
    // Check network health first
    try {
      const syncStatus = await this.bridge.checkSyncStatus();
      if (!syncStatus.ready) {
        return { skipped: true, created: 0, driven: 0, completed: 0 };
      }
    } catch (err) {
      console.log(`  ⚠️  Sync check failed: ${(err as Error).message}`);
      return { skipped: true, created: 0, driven: 0, completed: 0 };
    }
    
    let created = 0;
    let driven = 0;
    let completed = 0;

    // Drive existing fibers forward
    const fibersToRemove: string[] = [];
    for (const fiber of this.activeFibers) {
      try {
        const result = await this.driveFiber(fiber);
        if (result === 'progressed') {
          driven++;
        } else if (result === 'completed') {
          completed++;
          this.completedFibers++;
          fibersToRemove.push(fiber.id);
        }
        // 'waiting' means no action needed yet
      } catch (err) {
        console.log(`  ⚠️  Error driving fiber ${fiber.id.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
    
    // Remove completed fibers
    this.activeFibers = this.activeFibers.filter(f => !fibersToRemove.includes(f.id));

    // Start new fibers if needed
    const currentActive = this.activeFibers.length;
    if (currentActive < this.config.targetActiveFibers) {
      const fibersToStart = this.config.targetActiveFibers - currentActive;
      for (let i = 0; i < fibersToStart; i++) {
        const fiberType = this.selectFiberType();
        await this.startFiber(fiberType);
        created++;
      }
    }

    return {
      skipped: false,
      created,
      driven,
      completed,
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

    // Create fiber using appropriate bridge method based on workflowType
    const proposer = participants.get(def.roles[0])!;
    const counterparty = participants.get(def.roles[1]);
    
    try {
      let fiberId: string;
      
      if (def.workflowType === 'Contract' && counterparty) {
        // Use SDK-compliant contract creation
        const result = await this.bridge.proposeContract(
          proposer.privateKey,
          counterparty.address,
          stateData.terms as Record<string, unknown> ?? {},
          {
            title: (stateData as Record<string, unknown>).contractId as string ?? def.name,
            description: (stateData.terms as Record<string, unknown>)?.description as string ?? def.name,
          }
        );
        fiberId = result.contractId;
        console.log(`  ✅ Proposed ${def.name}: ${fiberId.slice(0, 12)}... (${proposer.address.slice(0, 10)} → ${counterparty.address.slice(0, 10)})`);
      } else {
        // Use generic fiber creation for custom types
        const createResult = await this.bridge.createFiber(
          proposer.privateKey,
          {
            workflowType: def.workflowType,
            type: def.type,
            name: def.name,
            initialState: def.initialState,
            states: def.states,
            transitions: def.transitions.map(t => ({
              from: t.from,
              to: t.to,
              event: t.event,
            })),
          },
          stateData as Record<string, unknown>
        );
        fiberId = createResult.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}...`);
      }

      // Add to active fibers
      this.activeFibers.push({
        id: fiberId,
        type,
        definition: def,
        participants,
        currentState: def.initialState,
        transitionIndex: 0,
        startedAt: Date.now(),
      });
    } catch (err) {
      console.log(`  ❌ Failed to create ${def.name}: ${(err as Error).message}`);
    }
  }

  /**
   * Drive a single fiber forward through its state machine
   * Returns: 'progressed' | 'completed' | 'waiting'
   */
  private async driveFiber(fiber: ActiveFiber): Promise<'progressed' | 'completed' | 'waiting'> {
    const def = fiber.definition;
    
    // Check if already in final state
    if (def.finalStates.includes(fiber.currentState)) {
      return 'completed';
    }
    
    // Find next available transition from current state
    const availableTransitions = def.transitions.filter(t => t.from === fiber.currentState);
    if (availableTransitions.length === 0) {
      return 'waiting'; // No transitions available
    }
    
    // Pick a transition (prefer non-rejection paths for now)
    const transition = availableTransitions.find(t => 
      !t.event.includes('reject') && !t.event.includes('cancel') && !t.event.includes('dispute')
    ) ?? availableTransitions[0];
    
    // Get the actor for this transition
    const actorAgent = fiber.participants.get(transition.actor);
    if (!actorAgent) {
      console.log(`  ⚠️  No agent for role ${transition.actor} in fiber ${fiber.id.slice(0, 8)}`);
      return 'waiting';
    }
    
    // Execute the transition using appropriate bridge method
    try {
      if (def.workflowType === 'Contract') {
        await this.executeContractTransition(fiber, transition, actorAgent);
      } else {
        // Generic fiber transition
        await this.bridge.transitionFiber(
          actorAgent.privateKey,
          fiber.id,
          transition.event,
          { agent: actorAgent.address }
        );
      }
      
      // Update state
      fiber.currentState = transition.to;
      fiber.transitionIndex++;
      
      console.log(`  → ${fiber.type}[${fiber.id.slice(0, 8)}]: ${transition.from} --${transition.event}--> ${transition.to}`);
      
      return def.finalStates.includes(transition.to) ? 'completed' : 'progressed';
    } catch (err) {
      console.log(`  ⚠️  Transition failed: ${(err as Error).message}`);
      return 'waiting';
    }
  }

  /**
   * Execute a contract-specific transition using SDK-compliant methods
   */
  private async executeContractTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'accept':
        await this.bridge.acceptContract(actor.privateKey, fiber.id);
        break;
      case 'reject':
        await this.bridge.rejectContract(actor.privateKey, fiber.id, 'Declined by counterparty');
        break;
      case 'deliver':
      case 'confirm':
      case 'submit_completion':
        await this.bridge.submitCompletion(actor.privateKey, fiber.id, `Completed by ${actor.address.slice(0, 10)}`);
        break;
      case 'finalize':
        await this.bridge.finalizeContract(actor.privateKey, fiber.id);
        break;
      case 'dispute':
        await this.bridge.disputeContract(actor.privateKey, fiber.id, 'Disputed by party');
        break;
      default:
        // Fallback to generic transition
        await this.bridge.transitionContract(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
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
