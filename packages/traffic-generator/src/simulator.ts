/**
 * Evolutionary Traffic Simulator
 * 
 * Main simulation engine that orchestrates agent population dynamics,
 * contract negotiations, and continuous metagraph traffic generation.
 */

import type {
  Agent,
  Contract,
  Market,
  MarketType,
  GeneratorConfig,
  SimulationContext,
  GenerationStats,
  TransitionResult,
  AgentFitness,
} from './types.js';
import { DEFAULT_CONFIG, MarketState as MS } from './types.js';
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
import {
  MARKET_SM_DEFINITION,
  getAvailableMarketEvents,
  selectMarketType,
  generateMarketData,
  computeMarketTransitionWeight,
  shouldAutoClose,
  shouldParticipateInMarket,
  selectOracles,
} from './market-workflows.js';

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
  private markets: Map<string, Market> = new Map();
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
    activeMarkets: number;
    avgFitness: number;
    temperature: number;
  } {
    const agents = Array.from(this.agents.values());
    const activeAgents = agents.filter((a) => a.state === 'ACTIVE');
    const avgFitness =
      activeAgents.length > 0
        ? activeAgents.reduce((sum, a) => sum + a.fitness.total, 0) / activeAgents.length
        : 0;
    
    const activeMarkets = Array.from(this.markets.values()).filter(
      m => m.state === MS.OPEN || m.state === MS.PROPOSED || m.state === MS.CLOSED || m.state === MS.RESOLVING
    ).length;

    return {
      generation: this.generation,
      population: this.agents.size,
      activeContracts: this.contracts.size,
      activeMarkets,
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
    // Determine if this agent is an oracle based on config fraction
    const isOracle = Math.random() < this.config.oracleFraction;
    
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
        // Market-related fields
        activeMarkets: new Set(),
        marketsCreated: 0,
        marketWins: 0,
        marketLosses: 0,
        totalMarketCommitments: 0,
        totalMarketWinnings: 0,
        isOracle,
        oracleResolutions: 0,
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
    
    // Determine if this agent is an oracle based on config fraction
    const isOracle = Math.random() < this.config.oracleFraction;
    
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
        // Market-related fields
        activeMarkets: new Set(),
        marketsCreated: 0,
        marketWins: 0,
        marketLosses: 0,
        totalMarketCommitments: 0,
        totalMarketWinnings: 0,
        isOracle,
        oracleResolutions: 0,
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
      // Market stats
      marketsCreated: 0,
      marketsOpened: 0,
      marketsClosed: 0,
      marketsSettled: 0,
      marketsRefunded: 0,
      marketCommitments: 0,
      marketCommitmentValue: 0,
      activeMarkets: 0,
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
      
      // 5. Process market lifecycle
      await this.processMarkets(stats);
      
      // 6. Market creation and participation
      for (const agent of activeAgents) {
        await this.processMarketActivity(agent, stats);
      }
      
      // 7. Update fitness scores
      this.updateAllFitness();
      
      // 8. Update context
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
      stats.activeMarkets = Array.from(this.markets.values()).filter(
        m => m.state === MS.OPEN || m.state === MS.PROPOSED || m.state === MS.CLOSED || m.state === MS.RESOLVING
      ).length;
      
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
      const taskDescription = `Task from ${agent.meta.displayName} to ${counterparty.meta.displayName}`;
      const result = await this.client.proposeContract(
        agent.privateKey,
        counterparty.address,  // Use address, not fiberId
        { 
          description: taskDescription,
          value: Math.floor(Math.random() * 100) + 10,
        },
        { title: taskDescription }
      );
      stats.successes++;
      console.log(`  ✅ Contract proposed: ${result.contractId}`);
      
      // Track contract
      const contract: Contract = {
        fiberId: result.contractId,  // contractId is the fiber ID
        proposer: agent.address,
        counterparty: counterparty.address,
        state: 'PROPOSED',
        task: taskDescription,
        terms: {},
        createdGeneration: this.generation,
        expectedCompletion: this.generation + Math.floor(Math.random() * 10) + 3,
      };
      
      this.contracts.set(result.contractId, contract);
      agent.meta.activeContracts.add(result.contractId);
      counterparty.meta.activeContracts.add(result.contractId);
      
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

  // ==========================================================================
  // Market Operations
  // ==========================================================================

  /**
   * Process market lifecycle: auto-close, resolve, finalize.
   */
  private async processMarkets(stats: GenerationStats): Promise<void> {
    const currentTimestamp = Date.now();
    
    for (const [fiberId, market] of this.markets.entries()) {
      // Clean up final state markets (stats were recorded when they transitioned)
      if (market.state === MS.SETTLED || market.state === MS.REFUNDED || market.state === MS.CANCELLED) {
        this.markets.delete(fiberId);
        // Log cleanup for visibility
        console.log(`  🧹 Cleaned up ${market.state.toLowerCase()} market ${fiberId.slice(0, 8)}`);
        continue;
      }
      
      const creator = this.agents.get(market.creator);
      if (!creator) continue;
      
      try {
        // Auto-close markets past deadline
        if (shouldAutoClose(market, currentTimestamp)) {
          stats.transactions++;
          await this.client.closeMarket(creator.privateKey, fiberId);
          market.state = MS.CLOSED;
          stats.marketsClosed++;
          stats.successes++;
          console.log(`  ⏰ Market ${fiberId.slice(0, 8)} auto-closed (deadline)`);
        }
        
        // Process based on current state
        switch (market.state) {
          case MS.PROPOSED:
            // Creator may open the market
            if (Math.random() < 0.7) {
              stats.transactions++;
              await this.client.openMarket(creator.privateKey, fiberId);
              market.state = MS.OPEN;
              stats.marketsOpened++;
              stats.successes++;
              console.log(`  📖 Market ${fiberId.slice(0, 8)} opened`);
            }
            break;
            
          case MS.CLOSED:
            // Check if market should be refunded (threshold not met)
            if (market.threshold && market.totalCommitted < market.threshold) {
              stats.transactions++;
              await this.client.refundMarket(creator.privateKey, fiberId, 'threshold_not_met');
              market.state = MS.REFUNDED;
              stats.marketsRefunded++;
              stats.successes++;
              console.log(`  💸 Market ${fiberId.slice(0, 8)} refunded (threshold not met: ${market.totalCommitted}/${market.threshold})`);
              
              // Update participant stats for refund
              this.processMarketRefund(market);
              break;
            }
            
            // Find an oracle to submit resolution
            await this.processMarketResolution(market, stats);
            break;
            
          case MS.RESOLVING:
            // Check if we can finalize
            if (market.resolutions.length >= market.quorum) {
              stats.transactions++;
              const finalOutcome = this.determineFinalOutcome(market);
              await this.client.finalizeMarket(
                creator.privateKey,
                fiberId,
                finalOutcome,
                { finalizedAt: Date.now() }
              );
              market.state = MS.SETTLED;
              market.finalOutcome = finalOutcome;
              stats.marketsSettled++;
              stats.successes++;
              console.log(`  ✅ Market ${fiberId.slice(0, 8)} settled: ${finalOutcome}`);
              
              // Update participant stats
              this.processMarketSettlement(market);
            }
            break;
        }
      } catch (err) {
        stats.failures++;
        // Log but continue
      }
    }
  }

  /**
   * Have oracles submit resolutions for closed markets.
   */
  private async processMarketResolution(market: Market, stats: GenerationStats): Promise<void> {
    // Find oracles who haven't submitted
    const pendingOracles = market.oracles.filter(
      addr => !market.resolutions.some(r => r.oracle === addr)
    );
    
    for (const oracleAddr of pendingOracles) {
      const oracle = this.agents.get(oracleAddr);
      if (!oracle || oracle.state !== 'ACTIVE') continue;
      
      // Oracle decides whether to submit this generation
      if (Math.random() < 0.6) {
        try {
          stats.transactions++;
          const outcome = this.generateOracleOutcome(market);
          await this.client.submitResolution(
            oracle.privateKey,
            market.fiberId,
            outcome,
            `oracle-proof-${Date.now().toString(36)}`
          );
          
          // Update local state
          market.resolutions.push({
            oracle: oracleAddr,
            outcome,
            submittedAt: Date.now(),
          });
          
          if (market.state === MS.CLOSED) {
            market.state = MS.RESOLVING;
          }
          
          oracle.meta.oracleResolutions++;
          stats.successes++;
          console.log(`  🔮 Oracle ${oracle.meta.displayName} resolved market ${market.fiberId.slice(0, 8)}: ${outcome}`);
        } catch (err) {
          stats.failures++;
        }
      }
    }
  }

  /**
   * Generate an oracle's outcome based on market type.
   */
  private generateOracleOutcome(market: Market): string | number {
    switch (market.marketType) {
      case 'prediction':
        return Math.random() > 0.5 ? 'YES' : 'NO';
        
      case 'auction':
        // Find highest bidder
        let highestBidder = '';
        let highestBid = 0;
        for (const [addr, commitment] of Object.entries(market.commitments)) {
          if (commitment.amount > highestBid) {
            highestBid = commitment.amount;
            highestBidder = addr;
          }
        }
        return highestBidder || 'NO_BIDS';
        
      case 'crowdfund':
      case 'group_buy':
        return market.totalCommitted >= (market.threshold ?? 0) ? 'SUCCESS' : 'FAILED';
        
      default:
        return 'RESOLVED';
    }
  }

  /**
   * Determine final outcome from oracle resolutions.
   */
  private determineFinalOutcome(market: Market): string | number {
    const outcomes = market.resolutions.map(r => r.outcome);
    const counts: Record<string, number> = {};
    
    for (const o of outcomes) {
      const key = String(o);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    
    // Majority wins
    let maxCount = 0;
    let winner = outcomes[0];
    for (const [outcome, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        winner = outcome;
      }
    }
    
    return winner;
  }

  /**
   * Update agent stats after market settlement.
   */
  private processMarketSettlement(market: Market): void {
    const creator = this.agents.get(market.creator);
    if (creator) {
      creator.meta.activeMarkets.delete(market.fiberId);
    }
    
    for (const [addr, commitment] of Object.entries(market.commitments)) {
      const agent = this.agents.get(addr);
      if (!agent) continue;
      
      agent.meta.activeMarkets.delete(market.fiberId);
      
      // Determine if agent won
      const isWinner = this.isMarketWinner(market, addr, commitment);
      if (isWinner) {
        agent.meta.marketWins++;
        // Calculate winnings (simplified)
        const winnings = this.calculateWinnings(market, addr, commitment);
        agent.meta.totalMarketWinnings += winnings;
      } else {
        agent.meta.marketLosses++;
      }
    }
  }

  /**
   * Check if an agent won in a market.
   */
  private isMarketWinner(
    market: Market,
    agentAddr: string,
    commitment: { amount: number; data: Record<string, unknown> }
  ): boolean {
    switch (market.marketType) {
      case 'prediction':
        return commitment.data?.prediction === market.finalOutcome;
        
      case 'auction':
        return agentAddr === market.finalOutcome;
        
      case 'crowdfund':
      case 'group_buy':
        // All participants "win" if threshold met
        return market.finalOutcome === 'SUCCESS';
        
      default:
        return false;
    }
  }

  /**
   * Calculate winnings for a market participant.
   */
  private calculateWinnings(
    market: Market,
    agentAddr: string,
    commitment: { amount: number; data: Record<string, unknown> }
  ): number {
    switch (market.marketType) {
      case 'prediction':
        // Proportional share of losing pool
        const winningPool = Object.entries(market.commitments)
          .filter(([_, c]) => c.data?.prediction === market.finalOutcome)
          .reduce((sum, [_, c]) => sum + c.amount, 0);
        const losingPool = market.totalCommitted - winningPool;
        const share = winningPool > 0 ? commitment.amount / winningPool : 0;
        return commitment.amount + Math.floor(losingPool * share * 0.98);
        
      case 'auction':
        // Winner gets item (no monetary winnings)
        return 0;
        
      case 'crowdfund':
      case 'group_buy':
        // Value delivered, not monetary
        return 0;
        
      default:
        return 0;
    }
  }

  /**
   * Handle refunds for a market that didn't meet its threshold.
   */
  private processMarketRefund(market: Market): void {
    const creator = this.agents.get(market.creator);
    if (creator) {
      creator.meta.activeMarkets.delete(market.fiberId);
    }
    
    // All participants get refunded - mark as losses since they don't win
    for (const [addr, _commitment] of Object.entries(market.commitments)) {
      const agent = this.agents.get(addr);
      if (!agent) continue;
      
      agent.meta.activeMarkets.delete(market.fiberId);
      // Refunds aren't wins or losses - they just get their money back
      // Don't increment marketLosses since it's not a real loss
    }
  }

  /**
   * Process market activity for an agent: creation and participation.
   */
  private async processMarketActivity(agent: Agent, stats: GenerationStats): Promise<void> {
    if (!agent.fiberId || agent.state !== 'ACTIVE') return;
    
    // Maybe create a market
    if (Math.random() < this.config.marketCreationRate) {
      await this.maybeCreateMarket(agent, stats);
    }
    
    // Maybe participate in existing markets
    for (const market of this.markets.values()) {
      if (market.state !== MS.OPEN) continue;
      
      if (shouldParticipateInMarket(agent, market, this.context)) {
        await this.maybeCommitToMarket(agent, market, stats);
      }
    }
  }

  /**
   * Agent creates a new market.
   */
  private async maybeCreateMarket(agent: Agent, stats: GenerationStats): Promise<void> {
    // Limit active markets per creator
    const createdCount = Array.from(this.markets.values()).filter(
      m => m.creator === agent.address && 
           (m.state === MS.PROPOSED || m.state === MS.OPEN || m.state === MS.CLOSED || m.state === MS.RESOLVING)
    ).length;
    
    if (createdCount >= 2) return;
    
    // Select market type
    const marketType = selectMarketType(this.config.marketTypeWeights);
    
    // Select oracles from population
    const population = Array.from(this.agents.values());
    const oracles = selectOracles(population, 3, agent.address);
    
    // If no oracles available for prediction markets, skip
    if (marketType === 'prediction' && oracles.length === 0) {
      return;
    }
    
    // Calculate deadline
    const deadlineTimestamp = Date.now() + 
      this.config.marketDeadlineGenerations * this.config.generationIntervalMs;
    
    // Generate market data
    const marketData = generateMarketData(
      marketType,
      agent.address,
      oracles,
      deadlineTimestamp
    );
    
    try {
      stats.transactions++;
      const result = await this.client.createMarket(
        agent.privateKey,
        MARKET_SM_DEFINITION,
        marketData
      );
      stats.successes++;
      stats.marketsCreated++;
      
      // Track market locally
      const market: Market = {
        fiberId: result.fiberId,
        marketType,
        state: MS.PROPOSED,
        creator: agent.address,
        title: marketData.title as string,
        description: marketData.description as string,
        deadline: deadlineTimestamp,
        threshold: marketData.threshold as number | null,
        oracles,
        quorum: Math.min(oracles.length, 3) || 1,
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        terms: marketData.terms as Record<string, unknown>,
        createdGeneration: this.generation,
      };
      
      this.markets.set(result.fiberId, market);
      agent.meta.activeMarkets.add(result.fiberId);
      agent.meta.marketsCreated++;
      
      console.log(`  🏪 ${agent.meta.displayName} created ${marketType} market: ${result.fiberId.slice(0, 8)}`);
    } catch (err) {
      stats.failures++;
      console.log(`  ❌ Market creation failed: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  /**
   * Agent commits to an existing market.
   */
  private async maybeCommitToMarket(
    agent: Agent,
    market: Market,
    stats: GenerationStats
  ): Promise<void> {
    // Generate commitment based on market type and agent risk tolerance
    const { weight, payload } = computeMarketTransitionWeight(
      market,
      'commit',
      agent,
      this.context
    );
    
    // Skip if weight too low
    if (weight < 0.2) return;
    
    const amount = (payload.amount as number) ?? Math.floor(Math.random() * 50) + 5;
    const data = (payload.data as Record<string, unknown>) ?? {};
    
    try {
      stats.transactions++;
      await this.client.commitToMarket(agent.privateKey, market.fiberId, amount, data);
      stats.successes++;
      stats.marketCommitments++;
      stats.marketCommitmentValue += amount;
      
      // Update local state
      const existingCommitment = market.commitments[agent.address];
      if (existingCommitment) {
        existingCommitment.amount += amount;
        existingCommitment.data = { ...existingCommitment.data, ...data };
        existingCommitment.lastCommitAt = Date.now();
      } else {
        market.commitments[agent.address] = {
          amount,
          data,
          lastCommitAt: Date.now(),
        };
      }
      market.totalCommitted += amount;
      
      agent.meta.activeMarkets.add(market.fiberId);
      agent.meta.totalMarketCommitments += amount;
      
      const actionWord = market.marketType === 'auction' ? 'bid' : 
                         market.marketType === 'crowdfund' ? 'pledged' :
                         market.marketType === 'group_buy' ? 'ordered' : 'committed';
      console.log(`  💰 ${agent.meta.displayName} ${actionWord} ${amount} to ${market.marketType} ${market.fiberId.slice(0, 8)}`);
    } catch (err) {
      stats.failures++;
    }
  }
}
