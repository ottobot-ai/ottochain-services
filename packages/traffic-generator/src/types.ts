/**
 * Evolutionary Traffic Generator Types
 * 
 * Genetic evolution-inspired model for continuous metagraph traffic simulation.
 */

import {
  SdkAgentState,
  SdkContractState,
} from '@ottochain/shared';

// Re-export SDK types for convenience
export { SdkAgentState, SdkContractState };

// ============================================================================
// State Type Helpers
// ============================================================================

/**
 * Extract string keys from TypeScript numeric enums
 */
export const enumStringKeys = <T extends Record<string, string | number>>(e: T) =>
  Object.keys(e).filter((k) => isNaN(Number(k))) as [string, ...string[]];

/**
 * On-chain agent states (from SDK)
 */
export type OnChainAgentState = keyof typeof SdkAgentState;

/**
 * Simulation agent state includes pre-registration state
 * UNREGISTERED = has wallet but no fiber yet (not on-chain)
 */
export type SimulationAgentState = 'UNREGISTERED' | OnChainAgentState;

/**
 * On-chain contract states (from SDK)
 */
export type OnChainContractState = keyof typeof SdkContractState;

// All valid on-chain agent states for validation
export const ON_CHAIN_AGENT_STATES = enumStringKeys(SdkAgentState);
export const ON_CHAIN_CONTRACT_STATES = enumStringKeys(SdkContractState);

// ============================================================================
// Agent Population Types
// ============================================================================

export interface Agent {
  /** Wallet address (DAG...) */
  address: string;
  /** Private key for signing */
  privateKey: string;
  /** Agent identity fiber ID (null if UNREGISTERED) */
  fiberId: string | null;
  /** Current state in the identity lifecycle */
  state: SimulationAgentState;
  /** Computed fitness score */
  fitness: AgentFitness;
  /** Simulation metadata */
  meta: AgentMeta;
}

export interface AgentFitness {
  /** Reputation from on-chain state */
  reputation: number;
  /** Contracts completed / proposed ratio */
  completionRate: number;
  /** Connections to high-rep agents (network centrality) */
  networkEffect: number;
  /** Survival bonus (generations alive) */
  age: number;
  /** Computed total fitness */
  total: number;
}

export interface AgentMeta {
  /** Generation when agent was created */
  birthGeneration: number;
  /** Display name for logging */
  displayName: string;
  /** Platform ID (for cross-platform simulation) */
  platform: string;
  /** Addresses this agent has vouched for */
  vouchedFor: Set<string>;
  /** Addresses that have vouched for this agent */
  receivedVouches: Set<string>;
  /** Active contract fiber IDs */
  activeContracts: Set<string>;
  /** Completed contract count */
  completedContracts: number;
  /** Failed/rejected contract count */
  failedContracts: number;
  /** Risk tolerance (0-1, affects transition choices) */
  riskTolerance: number;
}

// ============================================================================
// Contract Types
// ============================================================================

export interface Contract {
  /** Contract fiber ID */
  fiberId: string;
  /** Proposer agent address */
  proposer: string;
  /** Counterparty agent address */
  counterparty: string;
  /** Current contract state */
  state: OnChainContractState;
  /** Task description */
  task: string;
  /** Contract terms */
  terms: Record<string, unknown>;
  /** Generation when created */
  createdGeneration: number;
  /** Expected completion generation */
  expectedCompletion: number;
}

// ============================================================================
// Simulation Context
// ============================================================================

export interface SimulationContext {
  /** Current generation number */
  generation: number;
  /** Temperature for softmax selection (exploration vs exploitation) */
  temperature: number;
  /** Market conditions modifier (0-1, affects acceptance rates) */
  marketHealth: number;
  /** Base fitness required for activity */
  activityThreshold: number;
  /** Mutation probability (random path choice) */
  mutationRate: number;
}

export interface GenerationStats {
  generation: number;
  timestamp: Date;
  /** New agent registrations */
  births: number;
  /** Agent withdrawals */
  deaths: number;
  /** Unexpected path choices */
  mutations: number;
  /** Successful contract completions */
  completions: number;
  /** Contract rejections */
  rejections: number;
  /** Disputes filed */
  disputes: number;
  /** Total transactions submitted */
  transactions: number;
  /** Successful transactions */
  successes: number;
  /** Failed transactions */
  failures: number;
  /** Population size */
  populationSize: number;
  /** Average fitness */
  avgFitness: number;
  /** Max fitness */
  maxFitness: number;
}

// ============================================================================
// Transition Selection
// ============================================================================

export interface TransitionChoice {
  event: string;
  payload: Record<string, unknown>;
  /** Weight for selection */
  weight: number;
  /** Is this a mutation (unexpected choice)? */
  isMutation: boolean;
}

export interface TransitionResult {
  success: boolean;
  hash?: string;
  error?: string;
  event: string;
  fiberId: string;
  isMutation: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

export interface GeneratorConfig {
  /** Target population size */
  targetPopulation: number;
  /** Path to persisted wallet pool JSON (optional) */
  walletPoolPath?: string;
  /** Birth rate (new agents per generation) */
  birthRate: number;
  /** Death rate (withdrawals per generation as fraction of population) */
  deathRate: number;
  /** Activity rate (fraction of population active per generation) */
  activityRate: number;
  /** Contract proposal rate (per active agent) */
  proposalRate: number;
  /** Mutation probability (0-1) */
  mutationRate: number;
  /** Initial temperature for softmax */
  initialTemperature: number;
  /** Temperature decay per generation */
  temperatureDecay: number;
  /** Minimum temperature */
  minTemperature: number;
  /** Milliseconds between generations */
  generationIntervalMs: number;
  /** Max generations (0 = infinite) */
  maxGenerations: number;
  /** Bridge URL */
  bridgeUrl: string;
  /** ML0 URL for state queries */
  ml0Url: string;
  /** Platform names for agent distribution */
  platforms: string[];
  /** Seed for reproducible runs (optional) */
  seed?: number;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  targetPopulation: 20,
  birthRate: 2,
  deathRate: 0.05,
  activityRate: 0.4,
  proposalRate: 0.3,
  mutationRate: 0.1,
  initialTemperature: 1.0,
  temperatureDecay: 0.995,
  minTemperature: 0.1,
  generationIntervalMs: 10000,
  maxGenerations: 0, // Infinite
  bridgeUrl: 'http://localhost:3030',
  ml0Url: 'http://localhost:9200',
  platforms: ['discord', 'telegram', 'twitter', 'github'],
  seed: undefined,
};
