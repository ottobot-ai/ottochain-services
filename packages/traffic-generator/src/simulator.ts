/**
 * Evolutionary Traffic Simulator
 * 
 * Main simulation engine that orchestrates agent population dynamics,
 * contract negotiations, and continuous metagraph traffic generation.
 */

import type {
  Agent,
  Contract,
  GeneratorConfig,
  SimulationContext,
  GenerationStats,
  TransitionResult,
  AgentFitness,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { BridgeClient } from './bridge-client.js';
import {
  computeFitness,
  selectActiveAgents,
  selectCounterparty,
  selectForDeath,
  computeTransitionWeights,
  softmaxSelect,
} from './selection.js';
import {
  loadWalletPool,
  saveWalletPool,
  markWalletRegistered,
  getUnregisteredWallets,
  type WalletPool,
  type PersistedWallet,
} from './wallets.js';

export interface SimulatorEvents {
  onGenerationStart?: (gen: number) => void;
  onGenerationEnd?: (stats: GenerationStats) => void;
  onTransaction?: (result: TransitionResult) => void;
  onAgentBirth?: (agent: Agent) => void;
  onAgentDeath?: (agent: Agent) => void;
  onError?: (error: Error, context: string) => void;
}

export class Simulator {
  private config: GeneratorConfig;
  private client: BridgeClient;
  private events: SimulatorEvents;
  
  // Population state
  private agents: Map<string, Agent> = new Map();
  private contracts: Map<string, Contract> = new Map();
  private context: SimulationContext;
  
  // Wallet pool (for persistence)
  private walletPool: WalletPool | null = null;
  private walletIndex: number = 0;
  
  // Runtime state
  private running = false;
  private generation = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Partial<GeneratorConfig> = {},
    events: SimulatorEvents = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
    this.client = new BridgeClient({
      bridgeUrl: this.config.bridgeUrl,
      ml0Url: this.config.ml0Url,
      monitorUrl: this.config.monitorUrl,
    });
    
    this.context = {
      generation: 0,
      temperature: this.config.initialTemperature,
      marketHealth: 0.7 + Math.random() * 0.3, // Start with good market
      activityThreshold: 0.1,
      mutationRate: this.config.mutationRate,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    
    console.log('🧬 Starting evolutionary traffic simulator');
    console.log(`   Target population: ${this.config.targetPopulation}`);
    console.log(`   Generation interval: ${this.config.generationIntervalMs}ms`);
    console.log(`   Bridge: ${this.config.bridgeUrl}`);
    console.log(`   ML0: ${this.config.ml0Url}`);
    
    // Bootstrap initial population
    await this.bootstrapPopulation();
    
    // Start generation loop
    this.intervalHandle = setInterval(
      () => this.runGeneration(),
      this.config.generationIntervalMs
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    
    console.log('🛑 Simulator stopped');
  }

  getStats(): {
    generation: number;
    population: number;
    activeContracts: number;
    avgFitness: number;
    temperature: number;
  } {
    const agents = Array.from(this.agents.values());
    const activeAgents = agents.filter((a) => a.state === 'ACTIVE');
    const avgFitness =
      activeAgents.length > 0
        ? activeAgents.reduce((sum, a) => sum + a.fitness.total, 0) / activeAgents.length
        : 0;

    return {
      generation: this.generation,
      population: this.agents.size,
      activeContracts: this.contracts.size,
      avgFitness,
      temperature: this.context.temperature,
    };
  }

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  private async bootstrapPopulation(): Promise<void> {
    // Load wallet pool if configured
    if (this.config.walletPoolPath) {
      this.walletPool = loadWalletPool(this.config.walletPoolPath);
      if (this.walletPool) {
        console.log(`   Loaded ${this.walletPool.count} wallets from pool`);
        // Restore already-registered agents from pool
        const registered = this.walletPool.wallets.filter(w => w.registeredAt && w.agentId);
        for (const wallet of registered) {
          const agent = this.createAgentFromWallet(wallet, wallet.agentId!);
          this.agents.set(agent.address, agent);
        }
        if (registered.length > 0) {
          console.log(`   ✓ Restored ${registered.length} previously registered agents`);
        }
      }
    }
    
    // Create new agents up to target
    const needed = Math.max(0, Math.ceil(this.config.targetPopulation / 2) - this.agents.size);
    if (needed === 0) {
      console.log(`   ✓ Population already at target (${this.agents.size} agents)`);
      return;
    }
    
    console.log(`   Bootstrapping ${needed} new agents...`);
    const results = await Promise.allSettled(
      Array.from({ length: needed }, (_, i) => this.createAgent(i))
    );
    
    const successes = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`   ✓ Created ${successes}/${needed} agents`);
    
    // Save updated wallet pool
    if (this.walletPool && this.config.walletPoolPath) {
      saveWalletPool(this.walletPool, this.config.walletPoolPath);
    }
  }
  
  /**
   * Create an agent object from a persisted wallet (no registration needed)
   */
  private createAgentFromWallet(wallet: PersistedWallet, fiberId: string): Agent {
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      fiberId,
      state: 'ACTIVE', // Assume active if previously registered
      fitness: {
        reputation: 10,
        completionRate: 0,
        networkEffect: 0,
        age: 0,
        total: 0,
      },
      meta: {
        birthGeneration: 0,
        displayName: wallet.handle,
        platform: wallet.platform,
        vouchedFor: new Set(),
        receivedVouches: new Set(),
        activeContracts: new Set(),
        completedContracts: 0,
        failedContracts: 0,
        riskTolerance: Math.random(),
      },
    };
  }

  /**
   * Retry activation with faster backoff.
   * DL1 may not have synced the fiber yet even after it appears in ML0.
   */
  private async retryActivation(privateKey: string, fiberId: string, maxAttempts: number = 3): Promise<void> {
    let lastError: Error | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.client.activateAgent(privateKey, fiberId);
        return;
      } catch (err) {
        lastError = err as Error;
        const errMsg = String(err);
        // Only retry on CidNotFound or similar sync errors
        if (errMsg.includes('CidNotFound') || errMsg.includes('Bad Request') || errMsg.includes('400')) {
          const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s (faster)
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    throw lastError ?? new Error('Activation failed after retries');
  }

  /**
   * Wait for a fiber to appear in the ML0 state checkpoint.
   * Reduced delays for faster throughput (bridge handles sync internally).
   */
  private async waitForFiber(fiberId: string, maxAttempts: number = 5): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const checkpoint = await this.client.getCheckpoint();
        if (checkpoint.state?.stateMachines?.[fiberId]) {
          // Reduced delay - bridge waitForSync handles the rest
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
      } catch {
        // Ignore fetch errors
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  private async createAgent(index: number): Promise<Agent> {
    let walletAddress: string;
    let walletPrivateKey: string;
    let platform: string;
    let displayName: string;
    let persistedWallet: PersistedWallet | undefined;
    
    // Use wallet from pool if available, otherwise generate new
    if (this.walletPool) {
      const unregistered = getUnregisteredWallets(this.walletPool);
      if (unregistered.length === 0) {
        throw new Error('No more wallets available in pool');
      }
      persistedWallet = unregistered[0];
      walletAddress = persistedWallet.address;
      walletPrivateKey = persistedWallet.privateKey;
      platform = persistedWallet.platform;
      displayName = persistedWallet.handle;
    } else {
      // Legacy mode: generate new wallet
      const wallet = await this.client.generateWallet();
      walletAddress = wallet.address;
      walletPrivateKey = wallet.privateKey;
      platform = this.config.platforms[index % this.config.platforms.length];
      displayName = `Agent_${index}_${Date.now().toString(36)}`;
    }
    
    // Create agent object
    const agent: Agent = {
      address: walletAddress,
      privateKey: walletPrivateKey,
      fiberId: null,
      state: 'UNREGISTERED',
      fitness: {
        reputation: 10,
        completionRate: 0,
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
        riskTolerance: Math.random(), // Random risk profile
      },
    };
    
    // Compute initial fitness
    agent.fitness.total = computeFitness(agent);
    
    // Register on chain
    try {
      const result = await this.client.registerAgent(
        walletPrivateKey,
        displayName,
        platform,
        `${platform}_${walletAddress.slice(4, 12)}`
      );
      agent.fiberId = result.fiberId;
      agent.state = 'REGISTERED';
      
      // Mark wallet as registered in pool
      if (this.walletPool && persistedWallet) {
        markWalletRegistered(this.walletPool, walletAddress, result.fiberId);
        // Save pool periodically
        if (this.config.walletPoolPath) {
          saveWalletPool(this.walletPool, this.config.walletPoolPath);
        }
      }
      
      // Wait for fiber to be visible in state before activating
      // This is necessary because the metagraph needs time to process the transaction
      await this.waitForFiber(result.fiberId, 20);
      
      // Activate after fiber is confirmed (with retry for DL1 sync)
      await this.retryActivation(walletPrivateKey, result.fiberId, 3);
      agent.state = 'ACTIVE';
      
      this.agents.set(agent.address, agent);
      this.events.onAgentBirth?.(agent);
      
      return agent;
    } catch (err) {
      this.events.onError?.(err as Error, `createAgent(${displayName})`);
      throw err;
    }
  }

  // ==========================================================================
  // Generation Loop
  // ==========================================================================

  private async runGeneration(): Promise<void> {
    if (!this.running) return;
    
    // Check sync status before sending traffic
    const syncStatus = await this.client.checkSyncStatus();
    if (!syncStatus.ready) {
      const reason = syncStatus.error 
        ?? (syncStatus.gl0.fork ? 'GL0 fork detected' 
        : syncStatus.ml0.fork ? 'ML0 fork detected'
        : !syncStatus.allReady ? 'Nodes not ready'
        : !syncStatus.allHealthy ? 'Nodes unhealthy'
        : 'Unknown');
      console.log(`⏸️  Skipping generation - network not ready: ${reason}`);
      return;
    }
    
    this.generation++;
    this.context.generation = this.generation;
    this.events.onGenerationStart?.(this.generation);
    
    const stats: GenerationStats = {
      generation: this.generation,
      timestamp: new Date(),
      births: 0,
      deaths: 0,
      mutations: 0,
      completions: 0,
      rejections: 0,
      disputes: 0,
      transactions: 0,
      successes: 0,
      failures: 0,
      populationSize: this.agents.size,
      avgFitness: 0,
      maxFitness: 0,
    };

    try {
      // 1. Population dynamics: births and deaths
      await this.processPopulationDynamics(stats);
      
      // 2. Select active agents for this generation
      const population = Array.from(this.agents.values());
      const activeCount = Math.ceil(population.length * this.config.activityRate);
      
      // Debug: log agent state distribution
      if (this.generation % 5 === 0) {
        const stateCount = population.reduce((acc, a) => {
          acc[a.state] = (acc[a.state] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log(`  [debug] Agent states: ${JSON.stringify(stateCount)}, total=${population.length}`);
      }
      
      const activeAgents = selectActiveAgents(population, activeCount);
      
      // 3. Process agent activities
      for (const agent of activeAgents) {
        await this.processAgentActivity(agent, stats);
      }
      
      // 4. Process contract lifecycle
      await this.processContracts(stats);
      
      // 5. Update fitness scores
      this.updateAllFitness();
      
      // 6. Update context
      this.updateContext(stats);
      
      // Compute final stats
      const activeAgentList = population.filter((a) => a.state === 'ACTIVE');
      if (activeAgentList.length > 0) {
        stats.avgFitness =
          activeAgentList.reduce((sum, a) => sum + a.fitness.total, 0) /
          activeAgentList.length;
        stats.maxFitness = Math.max(...activeAgentList.map((a) => a.fitness.total));
      }
      stats.populationSize = this.agents.size;
      
    } catch (err) {
      this.events.onError?.(err as Error, `generation(${this.generation})`);
    }
    
    this.events.onGenerationEnd?.(stats);
    
    // Check termination
    if (
      this.config.maxGenerations > 0 &&
      this.generation >= this.config.maxGenerations
    ) {
      console.log(`\n🏁 Reached max generations (${this.config.maxGenerations})`);
      this.stop();
    }
  }

  // ==========================================================================
  // Population Dynamics
  // ==========================================================================

  private async processPopulationDynamics(stats: GenerationStats): Promise<void> {
    const population = Array.from(this.agents.values());
    
    // Births: create new agents if below target
    const currentActive = population.filter((a) => a.state === 'ACTIVE').length;
    if (currentActive < this.config.targetPopulation) {
      const birthCount = Math.min(
        this.config.birthRate,
        this.config.targetPopulation - currentActive
      );
      
      for (let i = 0; i < birthCount; i++) {
        try {
          await this.createAgent(this.agents.size + i);
          stats.births++;
        } catch {
          // Ignore birth failures
        }
      }
    }
    
    // Deaths: withdraw low-fitness agents
    const deathCount = Math.floor(population.length * this.config.deathRate);
    if (deathCount > 0) {
      const toWithdraw = selectForDeath(population, deathCount);
      
      for (const agent of toWithdraw) {
        try {
          if (agent.fiberId && agent.state === 'ACTIVE') {
            await this.client.transitionAgent(
              agent.privateKey,
              agent.fiberId,
              'withdraw',
              { timestamp: Date.now() }
            );
            agent.state = 'WITHDRAWN';
            stats.deaths++;
            this.events.onAgentDeath?.(agent);
          }
        } catch {
          // Ignore withdrawal failures
        }
      }
    }
  }

  // ==========================================================================
  // Agent Activity
  // ==========================================================================

  private async processAgentActivity(
    agent: Agent,
    stats: GenerationStats
  ): Promise<void> {
    if (!agent.fiberId || agent.state !== 'ACTIVE') return;
    
    // Determine available actions
    const availableEvents = this.getAvailableAgentEvents(agent);
    if (availableEvents.length === 0) return;
    
    // Compute transition weights and select
    const choices = computeTransitionWeights(agent, availableEvents, this.context);
    const chosen = softmaxSelect(choices, this.context.temperature);
    
    if (!chosen) return;
    
    if (chosen.isMutation) {
      stats.mutations++;
    }
    
    // Execute transition
    try {
      stats.transactions++;
      const result = await this.client.transitionAgent(
        agent.privateKey,
        agent.fiberId,
        chosen.event,
        chosen.payload
      );
      stats.successes++;
      
      // Update agent state based on event
      this.handleAgentTransition(agent, chosen.event, chosen.payload);
      
      this.events.onTransaction?.({
        success: true,
        hash: result.hash,
        event: chosen.event,
        fiberId: agent.fiberId,
        isMutation: chosen.isMutation,
      });
    } catch (err) {
      stats.failures++;
      this.events.onTransaction?.({
        success: false,
        error: (err as Error).message,
        event: chosen.event,
        fiberId: agent.fiberId,
        isMutation: chosen.isMutation,
      });
    }
    
    // Maybe propose a contract
    if (Math.random() < this.config.proposalRate) {
      await this.maybePropose(agent, stats);
    }
    
    // Maybe vouch for another agent
    if (Math.random() < 0.2) {
      await this.maybeVouch(agent, stats);
    }
  }

  private getAvailableAgentEvents(agent: Agent): string[] {
    switch (agent.state) {
      case 'REGISTERED':
        return ['activate'];
      case 'ACTIVE':
        return ['submit_attestation', 'submit_violation', 'file_challenge', 'withdraw'];
      case 'CHALLENGED':
        return []; // Wait for resolution
      case 'SUSPENDED':
        return []; // Wait for probation
      case 'PROBATION':
        return ['submit_attestation'];
      default:
        return [];
    }
  }

  private handleAgentTransition(
    agent: Agent,
    event: string,
    _payload: Record<string, unknown>
  ): void {
    switch (event) {
      case 'withdraw':
        agent.state = 'WITHDRAWN';
        break;
      case 'file_challenge':
        // Would need to track challenged agents
        break;
      // Other state updates happen via chain query
    }
  }

  // ==========================================================================
  // Contract Operations
  // ==========================================================================

  private async maybePropose(agent: Agent, stats: GenerationStats): Promise<void> {
    // Don't propose if already in too many contracts
    if (agent.meta.activeContracts.size >= 3) return;
    
    // Select counterparty
    const population = Array.from(this.agents.values());
    const activeAgents = population.filter(a => a.state === 'ACTIVE' && a.fiberId);
    if (activeAgents.length < 2) {
      // Debug: log why we can't propose
      if (this.generation % 10 === 0) {
        console.log(`  [debug] Can't propose: only ${activeAgents.length} ACTIVE agents with fiberIds (need 2+)`);
      }
      return;
    }
    
    const counterparty = selectCounterparty(agent, population);
    if (!counterparty || !counterparty.fiberId) {
      if (this.generation % 10 === 0) {
        console.log(`  [debug] No eligible counterparty for ${agent.meta.displayName} (state=${agent.state}, fid=${agent.fiberId?.slice(0,8)})`);
      }
      return;
    }
    
    console.log(`  📝 Proposing contract: ${agent.meta.displayName} -> ${counterparty.meta.displayName}`);
    
    try {
      stats.transactions++;
      const result = await this.client.proposeContract(
        agent.privateKey,
        counterparty.fiberId,
        `Task from ${agent.meta.displayName} to ${counterparty.meta.displayName}`,
        { value: Math.floor(Math.random() * 100) + 10 }
      );
      stats.successes++;
      console.log(`  ✅ Contract proposed: ${result.fiberId}`);
      
      // Track contract
      const contract: Contract = {
        fiberId: result.fiberId,
        proposer: agent.address,
        counterparty: counterparty.address,
        state: 'PROPOSED',
        task: `Simulated task`,
        terms: {},
        createdGeneration: this.generation,
        expectedCompletion: this.generation + Math.floor(Math.random() * 10) + 3,
      };
      
      this.contracts.set(result.fiberId, contract);
      agent.meta.activeContracts.add(result.fiberId);
      counterparty.meta.activeContracts.add(result.fiberId);
      
    } catch (err) {
      stats.failures++;
      console.log(`  ❌ Contract proposal failed: ${(err as Error).message?.slice(0, 100)}`);
    }
  }

  private async maybeVouch(agent: Agent, stats: GenerationStats): Promise<void> {
    // Pick someone to vouch for (prefer network connections)
    const candidates = Array.from(this.agents.values()).filter(
      (a) =>
        a.state === 'ACTIVE' &&
        a.address !== agent.address &&
        !agent.meta.vouchedFor.has(a.address)
    );
    
    if (candidates.length === 0) return;
    
    // Prefer agents we've contracted with
    const connected = candidates.filter(
      (c) =>
        agent.meta.receivedVouches.has(c.address) ||
        c.meta.vouchedFor.has(agent.address)
    );
    
    const target = connected.length > 0
      ? connected[Math.floor(Math.random() * connected.length)]
      : candidates[Math.floor(Math.random() * candidates.length)];
    
    if (!target.fiberId) return;
    
    try {
      stats.transactions++;
      await this.client.vouchForAgent(
        agent.privateKey,
        target.fiberId,
        agent.address,
        'Simulated vouch'
      );
      stats.successes++;
      
      // Update network
      agent.meta.vouchedFor.add(target.address);
      target.meta.receivedVouches.add(agent.address);
      
    } catch (err) {
      stats.failures++;
    }
  }

  private async processContracts(stats: GenerationStats): Promise<void> {
    for (const [fiberId, contract] of this.contracts.entries()) {
      // Skip completed contracts
      if (contract.state === 'COMPLETED' || contract.state === 'REJECTED') {
        this.contracts.delete(fiberId);
        continue;
      }
      
      const counterpartyAgent = this.agents.get(contract.counterparty);
      const proposerAgent = this.agents.get(contract.proposer);
      
      if (!counterpartyAgent || !proposerAgent) {
        this.contracts.delete(fiberId);
        continue;
      }
      
      try {
        if (contract.state === 'PROPOSED') {
          // Counterparty decides: accept or reject
          const choices = computeTransitionWeights(
            counterpartyAgent,
            ['accept', 'reject'],
            this.context
          );
          const chosen = softmaxSelect(choices, this.context.temperature);
          
          if (chosen) {
            stats.transactions++;
            await this.client.transitionContract(
              counterpartyAgent.privateKey,
              fiberId,
              chosen.event,
              chosen.payload
            );
            stats.successes++;
            
            contract.state = chosen.event === 'accept' ? 'ACTIVE' : 'REJECTED';
            if (contract.state === 'REJECTED') {
              stats.rejections++;
              proposerAgent.meta.activeContracts.delete(fiberId);
              counterpartyAgent.meta.activeContracts.delete(fiberId);
              proposerAgent.meta.failedContracts++;
            }
            
            if (chosen.isMutation) stats.mutations++;
          }
        } else if (contract.state === 'ACTIVE') {
          // Check if it's time to complete
          if (this.generation >= contract.expectedCompletion) {
            // Decide: complete or dispute
            const choices = computeTransitionWeights(
              proposerAgent,
              ['complete', 'dispute'],
              this.context
            );
            const chosen = softmaxSelect(choices, this.context.temperature);
            
            if (chosen) {
              stats.transactions++;
              await this.client.transitionContract(
                proposerAgent.privateKey,
                fiberId,
                chosen.event,
                chosen.payload
              );
              stats.successes++;
              
              if (chosen.event === 'complete') {
                contract.state = 'COMPLETED';
                stats.completions++;
                proposerAgent.meta.completedContracts++;
                counterpartyAgent.meta.completedContracts++;
              } else {
                contract.state = 'DISPUTED';
                stats.disputes++;
              }
              
              proposerAgent.meta.activeContracts.delete(fiberId);
              counterpartyAgent.meta.activeContracts.delete(fiberId);
              
              if (chosen.isMutation) stats.mutations++;
            }
          }
        }
      } catch (err) {
        stats.failures++;
      }
    }
  }

  // ==========================================================================
  // Fitness Updates
  // ==========================================================================

  private updateAllFitness(): void {
    for (const agent of this.agents.values()) {
      this.updateAgentFitness(agent);
    }
  }

  private updateAgentFitness(agent: Agent): void {
    // Age increments each generation
    agent.fitness.age = this.generation - agent.meta.birthGeneration;
    
    // Completion rate
    const totalContracts =
      agent.meta.completedContracts + agent.meta.failedContracts;
    agent.fitness.completionRate =
      totalContracts > 0
        ? agent.meta.completedContracts / totalContracts
        : 0.5; // Neutral for new agents
    
    // Network effect (vouches given and received)
    const networkSize = agent.meta.vouchedFor.size + agent.meta.receivedVouches.size;
    agent.fitness.networkEffect = Math.min(1, networkSize / 10);
    
    // Total fitness
    agent.fitness.total = computeFitness(agent);
  }

  // ==========================================================================
  // Context Updates
  // ==========================================================================

  private updateContext(stats: GenerationStats): void {
    // Decay temperature (reduce exploration over time)
    this.context.temperature = Math.max(
      this.config.minTemperature,
      this.context.temperature * this.config.temperatureDecay
    );
    
    // Update market health based on completion rate
    if (stats.transactions > 0) {
      const successRate = stats.successes / stats.transactions;
      this.context.marketHealth =
        this.context.marketHealth * 0.9 + successRate * 0.1;
    }
    
    // Small random perturbation
    this.context.marketHealth = Math.max(
      0.3,
      Math.min(1, this.context.marketHealth + (Math.random() - 0.5) * 0.1)
    );
  }
}
