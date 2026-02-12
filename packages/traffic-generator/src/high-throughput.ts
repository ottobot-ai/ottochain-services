/**
 * High-Throughput Traffic Generator
 * 
 * Designed for 1000+ participants and 10+ TPS continuous load.
 * Manages multiple concurrent fiber streams across all workflow types.
 */

import crypto from 'crypto';
import type {
  Agent,
  GeneratorConfig,
  GenerationStats,
  AgentFitness,
} from './types.js';
import { DEFAULT_CONFIG, SdkAgentState as AgentState } from './types.js';
import { BridgeClient } from './bridge-client.js';
import {
  computeFitness,
  selectAgentByFitness,
  softmaxSelect,
} from './selection.js';
import {
  ALL_WORKFLOWS,
  selectWorkflowType,
  getAvailableTransitions,
  isWorkflowComplete,
  type WorkflowDefinition,
  type WorkflowTransition,
  type TransitionContext,
} from './workflows.js';

// ============================================================================
// Types
// ============================================================================

export interface HighThroughputConfig extends GeneratorConfig {
  /** Target transactions per second */
  targetTps: number;
  /** Maximum concurrent pending transactions */
  maxPendingTx: number;
  /** Batch size for parallel submissions */
  batchSize: number;
  /** Workflows to include */
  enabledWorkflows: string[];
  /** Max fibers per workflow type */
  maxFibersPerType: number;
}

export const HIGH_THROUGHPUT_DEFAULTS: HighThroughputConfig = {
  ...DEFAULT_CONFIG,
  targetPopulation: 1000,
  birthRate: 50,
  deathRate: 0.01,
  activityRate: 0.3,
  proposalRate: 0.4,
  mutationRate: 0.08,
  generationIntervalMs: 1000, // 1 second generations
  targetTps: 10,
  maxPendingTx: 100,
  batchSize: 20,
  enabledWorkflows: ['AgentIdentity', 'Contract', 'VOTING', 'TokenEscrow', 'TicTacToe', 'SimpleOrder', 'ApprovalWorkflow'],
  maxFibersPerType: 500,
};

interface ActiveFiber {
  fiberId: string;
  workflow: WorkflowDefinition;
  currentState: string;
  participants: string[]; // Agent addresses
  ownerAddress: string;
  createdGeneration: number;
  lastActivityGeneration: number;
  sequenceNumber: number;
}

interface TransactionJob {
  fiberId: string;
  event: string;
  payload: Record<string, unknown>;
  signerKey: string;
  workflowType: string;
}

// ============================================================================
// High-Throughput Simulator
// ============================================================================

export class HighThroughputSimulator {
  private config: HighThroughputConfig;
  private client: BridgeClient;
  
  // Population
  private agents: Map<string, Agent> = new Map();
  private agentsByFiber: Map<string, Agent> = new Map(); // fiberId -> agent
  
  // Active fibers by workflow type
  private fibers: Map<string, ActiveFiber> = new Map();
  private fibersByType: Map<string, Set<string>> = new Map();
  
  // Runtime
  private running = false;
  private generation = 0;
  private pendingTx = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  
  // Stats
  private totalTxSubmitted = 0;
  private totalTxSuccess = 0;
  private totalTxFailed = 0;
  private recentTxTimes: number[] = [];

  constructor(config: Partial<HighThroughputConfig> = {}) {
    this.config = { ...HIGH_THROUGHPUT_DEFAULTS, ...config };
    this.client = new BridgeClient({
      bridgeUrl: this.config.bridgeUrl,
      ml0Url: this.config.ml0Url,
      timeoutMs: 15000,
    });
    
    // Initialize fiber type maps
    for (const wf of ALL_WORKFLOWS) {
      this.fibersByType.set(wf.type, new Set());
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    
    console.log('🚀 Starting high-throughput traffic generator');
    console.log(`   Target: ${this.config.targetTps} TPS`);
    console.log(`   Population: ${this.config.targetPopulation} agents`);
    console.log(`   Batch size: ${this.config.batchSize}`);
    console.log(`   Workflows: ${this.config.enabledWorkflows.join(', ')}`);
    console.log(`   Bridge: ${this.config.bridgeUrl}`);
    
    // Bootstrap agents
    await this.bootstrapAgents();
    
    // Start generation loop
    this.intervalHandle = setInterval(
      () => this.runGeneration(),
      this.config.generationIntervalMs
    );
    
    // Start TPS reporter
    setInterval(() => this.reportTps(), 5000);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    
    console.log('\n📊 Final stats:');
    console.log(`   Total transactions: ${this.totalTxSubmitted}`);
    console.log(`   Success rate: ${((this.totalTxSuccess / this.totalTxSubmitted) * 100).toFixed(1)}%`);
    console.log(`   Active fibers: ${this.fibers.size}`);
    console.log(`   Population: ${this.agents.size}`);
  }

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  private async bootstrapAgents(): Promise<void> {
    const batchCount = Math.ceil(this.config.targetPopulation / 50);
    console.log(`   Bootstrapping ${this.config.targetPopulation} agents in ${batchCount} batches...`);
    
    let created = 0;
    for (let batch = 0; batch < batchCount && created < this.config.targetPopulation; batch++) {
      const batchSize = Math.min(50, this.config.targetPopulation - created);
      const promises = Array.from({ length: batchSize }, (_, i) =>
        this.createAgent(created + i).catch(() => null)
      );
      
      const results = await Promise.all(promises);
      const successes = results.filter((r) => r !== null).length;
      created += successes;
      
      process.stdout.write(`\r   Created ${created}/${this.config.targetPopulation} agents`);
    }
    console.log('\n   ✓ Bootstrap complete');
  }

  private async createAgent(index: number): Promise<Agent | null> {
    try {
      const wallet = await this.client.generateWallet();
      const platform = this.config.platforms[index % this.config.platforms.length];
      const displayName = `Agent_${index}_${Date.now().toString(36).slice(-4)}`;
      
      const agent: Agent = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        fiberId: null,
        state: 'UNREGISTERED',
        fitness: {
          reputation: 10,
          completionRate: 0.5,
          networkEffect: 0,
          age: 0,
          total: 0,
        },
        meta: {
          birthGeneration: this.generation,
          displayName,
          platform,
          vouchedFor: new Set(),
          receivedVouches: new Set(),
          activeContracts: new Set(),
          completedContracts: 0,
          failedContracts: 0,
          riskTolerance: Math.random(),
          // Market-related fields
          activeMarkets: new Set(),
          marketsCreated: 0,
          marketWins: 0,
          marketLosses: 0,
          totalMarketCommitments: 0,
          totalMarketWinnings: 0,
          isOracle: Math.random() < 0.2, // 20% are oracles
          oracleResolutions: 0,
        },
      };
      
      agent.fitness.total = computeFitness(agent);
      
      // Register on chain
      const result = await this.client.registerAgent(
        wallet.privateKey,
        displayName,
        platform,
        `${platform}_${wallet.address.slice(4, 12)}`
      );
      
      agent.fiberId = result.fiberId;
      agent.state = AgentState.AGENT_STATE_REGISTERED;
      
      // Activate
      await this.client.activateAgent(wallet.privateKey, result.fiberId);
      agent.state = AgentState.AGENT_STATE_ACTIVE;
      
      this.agents.set(agent.address, agent);
      this.agentsByFiber.set(result.fiberId, agent);
      
      return agent;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Generation Loop
  // ==========================================================================

  private async runGeneration(): Promise<void> {
    if (!this.running) return;
    this.generation++;
    
    const jobs: TransactionJob[] = [];
    
    // 1. Spawn new fibers to maintain activity
    await this.spawnNewFibers(jobs);
    
    // 2. Progress existing fibers
    this.progressFibers(jobs);
    
    // 3. Clean up completed fibers
    this.cleanupCompletedFibers();
    
    // 4. Submit transaction batch
    if (jobs.length > 0) {
      await this.submitBatch(jobs);
    }
    
    // 5. Maybe spawn more agents
    if (this.agents.size < this.config.targetPopulation && Math.random() < 0.1) {
      this.createAgent(this.agents.size).catch(() => {});
    }
  }

  // ==========================================================================
  // Fiber Management
  // ==========================================================================

  private async spawnNewFibers(jobs: TransactionJob[]): Promise<void> {
    const enabledWorkflows = ALL_WORKFLOWS.filter((w) =>
      this.config.enabledWorkflows.includes(w.type)
    );
    
    // Calculate how many fibers we need per type
    for (const workflow of enabledWorkflows) {
      const typeSet = this.fibersByType.get(workflow.type)!;
      const currentCount = typeSet.size;
      const targetCount = Math.floor(
        (workflow.frequency / enabledWorkflows.reduce((s, w) => s + w.frequency, 0)) *
        this.config.maxFibersPerType
      );
      
      // Spawn if below target
      if (currentCount < targetCount) {
        const toSpawn = Math.min(5, targetCount - currentCount);
        for (let i = 0; i < toSpawn; i++) {
          await this.spawnFiber(workflow, jobs);
        }
      }
    }
  }

  private async spawnFiber(
    workflow: WorkflowDefinition,
    jobs: TransactionJob[]
  ): Promise<void> {
    // Select participants
    const participants = this.selectParticipants(
      workflow.minParticipants,
      workflow.maxParticipants
    );
    
    if (participants.length < workflow.minParticipants) return;
    
    const owner = participants[0];
    const fiberId = crypto.randomUUID();
    
    try {
      // Create the fiber via bridge's generic fiber endpoint
      let result: { fiberId: string; hash: string };
      
      if (workflow.type === 'AgentIdentity') {
        // Agent identity is created during agent registration, skip
        return;
      }
      
      // Use the generic fiber creation endpoint with the workflow's state machine definition
      const createCtx = {
        fiberId,
        participants: participants.map((p) => p.address),
        ownerAddress: owner.address,
        generation: this.generation,
      };
      
      const initialData = workflow.initialDataFn(createCtx);
      
      result = await this.client.createFiber(
        owner.privateKey,
        workflow.stateMachineDefinition,
        initialData,
        { fiberId }
      );
      
      const fiber: ActiveFiber = {
        fiberId: result.fiberId,
        workflow,
        currentState: workflow.states[0],
        participants: participants.map((p) => p.address),
        ownerAddress: owner.address,
        createdGeneration: this.generation,
        lastActivityGeneration: this.generation,
        sequenceNumber: 0,
      };
      
      this.fibers.set(result.fiberId, fiber);
      this.fibersByType.get(workflow.type)!.add(result.fiberId);
      
      // Track in participants
      for (const p of participants) {
        p.meta.activeContracts.add(result.fiberId);
      }
      
    } catch {
      // Ignore spawn failures
    }
  }

  private selectParticipants(min: number, max: number): Agent[] {
    const count = min + Math.floor(Math.random() * (max - min + 1));
    const selected: Agent[] = [];
    const excluded = new Set<string>();
    
    for (let i = 0; i < count; i++) {
      const agent = selectAgentByFitness(
        Array.from(this.agents.values()),
        excluded
      );
      if (agent) {
        selected.push(agent);
        excluded.add(agent.address);
      }
    }
    
    return selected;
  }

  private progressFibers(jobs: TransactionJob[]): void {
    const fibersToProcess = Array.from(this.fibers.values())
      .filter((f) => !isWorkflowComplete(f.workflow, f.currentState))
      .sort(() => Math.random() - 0.5) // Shuffle
      .slice(0, this.config.batchSize * 2); // Process more than batch size, some may not have valid transitions
    
    for (const fiber of fibersToProcess) {
      if (jobs.length >= this.config.batchSize) break;
      
      const transition = this.selectTransition(fiber);
      if (!transition) continue;
      
      const actor = this.selectActor(fiber, transition);
      if (!actor) continue;
      
      const ctx: TransitionContext = {
        fiberId: fiber.fiberId,
        currentState: fiber.currentState,
        participants: fiber.participants,
        ownerAddress: fiber.ownerAddress,
        generation: this.generation,
        timestamp: Date.now(),
      };
      
      const payload = transition.payloadFn
        ? transition.payloadFn(ctx)
        : { timestamp: Date.now() };
      
      jobs.push({
        fiberId: fiber.fiberId,
        event: transition.event,
        payload,
        signerKey: actor.privateKey,
        workflowType: fiber.workflow.type,
      });
    }
  }

  private selectTransition(fiber: ActiveFiber): WorkflowTransition | null {
    const available = getAvailableTransitions(fiber.workflow, fiber.currentState);
    if (available.length === 0) return null;
    
    // Apply mutation chance
    const mutate = Math.random() < this.config.mutationRate;
    
    const choices = available.map((t) => ({
      transition: t,
      weight: mutate ? 1 - t.weight : t.weight,
    }));
    
    const totalWeight = choices.reduce((s, c) => s + c.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const { transition, weight } of choices) {
      random -= weight;
      if (random <= 0) return transition;
    }
    
    return choices[0]?.transition || null;
  }

  private selectActor(fiber: ActiveFiber, transition: WorkflowTransition): Agent | null {
    const { actor } = transition;
    
    if (actor === 'owner') {
      return this.agents.get(fiber.ownerAddress) || null;
    }
    
    if (actor === 'counterparty' && fiber.participants.length > 1) {
      return this.agents.get(fiber.participants[1]) || null;
    }
    
    if (actor === 'third_party') {
      // Find an agent not in participants
      for (const agent of this.agents.values()) {
        if (!fiber.participants.includes(agent.address) && agent.state === AgentState.AGENT_STATE_ACTIVE) {
          return agent;
        }
      }
      return null;
    }
    
    // 'any' - pick random participant
    const addr = fiber.participants[Math.floor(Math.random() * fiber.participants.length)];
    return this.agents.get(addr) || null;
  }

  private cleanupCompletedFibers(): void {
    for (const [fiberId, fiber] of this.fibers.entries()) {
      if (isWorkflowComplete(fiber.workflow, fiber.currentState)) {
        // Update participant stats
        for (const addr of fiber.participants) {
          const agent = this.agents.get(addr);
          if (agent) {
            agent.meta.activeContracts.delete(fiberId);
            if (fiber.currentState === 'COMPLETED' || fiber.currentState === 'RELEASED' || fiber.currentState === 'DELIVERED' || fiber.currentState === 'APPROVED') {
              agent.meta.completedContracts++;
            } else {
              agent.meta.failedContracts++;
            }
          }
        }
        
        this.fibers.delete(fiberId);
        this.fibersByType.get(fiber.workflow.type)?.delete(fiberId);
      }
      
      // Also clean up stale fibers (no activity for 100 generations)
      if (this.generation - fiber.lastActivityGeneration > 100) {
        this.fibers.delete(fiberId);
        this.fibersByType.get(fiber.workflow.type)?.delete(fiberId);
      }
    }
  }

  // ==========================================================================
  // Transaction Submission
  // ==========================================================================

  private async submitBatch(jobs: TransactionJob[]): Promise<void> {
    const startTime = Date.now();
    
    const results = await Promise.allSettled(
      jobs.map((job) => this.submitTransaction(job))
    );
    
    const elapsed = Date.now() - startTime;
    const successes = results.filter((r) => r.status === 'fulfilled').length;
    const failures = results.length - successes;
    
    this.totalTxSubmitted += results.length;
    this.totalTxSuccess += successes;
    this.totalTxFailed += failures;
    
    // Track for TPS calculation
    this.recentTxTimes.push(...Array(successes).fill(Date.now()));
    
    // Update fiber states for successes
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const job = jobs[i];
        const fiber = this.fibers.get(job.fiberId);
        if (fiber) {
          // Find the transition and update state
          const transition = fiber.workflow.transitions.find(
            (t) => t.from === fiber.currentState && t.event === job.event
          );
          if (transition) {
            fiber.currentState = transition.to;
            fiber.lastActivityGeneration = this.generation;
            fiber.sequenceNumber++;
          }
        }
      }
    }
  }

  private async submitTransaction(job: TransactionJob): Promise<void> {
    // Use the generic fiber transition endpoint for all workflow types
    await this.client.transitionFiber(
      job.signerKey,
      job.fiberId,
      job.event,
      job.payload
    );
  }

  // ==========================================================================
  // Reporting
  // ==========================================================================

  private reportTps(): void {
    // Calculate TPS over last 5 seconds
    const cutoff = Date.now() - 5000;
    this.recentTxTimes = this.recentTxTimes.filter((t) => t > cutoff);
    const tps = this.recentTxTimes.length / 5;
    
    const fiberCounts = Array.from(this.fibersByType.entries())
      .map(([type, set]) => `${type}:${set.size}`)
      .join(' ');
    
    console.log(
      `[Gen ${this.generation}] ` +
      `TPS: ${tps.toFixed(1)} | ` +
      `Tx: ${this.totalTxSuccess}/${this.totalTxSubmitted} | ` +
      `Fibers: ${this.fibers.size} (${fiberCounts}) | ` +
      `Agents: ${this.agents.size}`
    );
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function runHighThroughput(): Promise<void> {
  const config: Partial<HighThroughputConfig> = {
    targetPopulation: parseInt(process.env.TARGET_POPULATION ?? '1000', 10),
    targetTps: parseInt(process.env.TARGET_TPS ?? '10', 10),
    batchSize: parseInt(process.env.BATCH_SIZE ?? '20', 10),
    generationIntervalMs: parseInt(process.env.GENERATION_INTERVAL_MS ?? '1000', 10),
    maxFibersPerType: parseInt(process.env.MAX_FIBERS_PER_TYPE ?? '500', 10),
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://localhost:3030',
    ml0Url: process.env.ML0_URL ?? 'http://localhost:9200',
    enabledWorkflows: (process.env.WORKFLOWS ?? 'AgentIdentity,Contract,Voting,TokenEscrow,TicTacToe,SimpleOrder,ApprovalWorkflow').split(','),
  };
  
  const simulator = new HighThroughputSimulator(config);
  
  process.on('SIGINT', () => {
    simulator.stop();
    process.exit(0);
  });
  
  await simulator.start();
}
