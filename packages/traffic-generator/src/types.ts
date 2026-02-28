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
// Market Types
// ============================================================================

/**
 * Market states from the Market state machine definition
 */
export enum MarketState {
  PROPOSED = 'PROPOSED',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  RESOLVING = 'RESOLVING',
  SETTLED = 'SETTLED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

/**
 * Supported market types
 */
export type MarketType = 'prediction' | 'auction' | 'crowdfund' | 'group_buy';

/**
 * Commitment from a participant in a market
 */
export interface MarketCommitment {
  amount: number;
  data: Record<string, unknown>;
  lastCommitAt: number;
}

/**
 * Oracle resolution submission
 */
export interface MarketResolution {
  oracle: string;
  outcome: string | number;
  proof?: string;
  submittedAt: number;
}

/**
 * Market claim record
 */
export interface MarketClaim {
  claimedAt: number;
  amount: number;
}

/**
 * Market instance tracked by the simulator
 */
export interface Market {
  /** Market fiber ID */
  fiberId: string;
  /** Type of market */
  marketType: MarketType;
  /** Current state */
  state: MarketState;
  /** Creator agent address */
  creator: string;
  /** Market title */
  title: string;
  /** Market description */
  description: string;
  /** Deadline timestamp (optional) */
  deadline: number | null;
  /** Minimum threshold for success (optional) */
  threshold: number | null;
  /** Oracle addresses (for prediction markets) */
  oracles: string[];
  /** Required oracle quorum */
  quorum: number;
  /** Participant commitments (address -> commitment) */
  commitments: Record<string, MarketCommitment>;
  /** Total committed amount */
  totalCommitted: number;
  /** Oracle resolutions */
  resolutions: MarketResolution[];
  /** Winner claims */
  claims: Record<string, MarketClaim>;
  /** Market-type-specific terms */
  terms: Record<string, unknown>;
  /** Generation when created */
  createdGeneration: number;
  /** Final outcome (after settlement) */
  finalOutcome?: string | number;
}

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
  // Market-related fields
  /** Active market fiber IDs this agent participates in */
  activeMarkets: Set<string>;
  /** Markets this agent has created */
  marketsCreated: number;
  /** Markets where this agent won (prediction correct, auction won) */
  marketWins: number;
  /** Markets where this agent lost */
  marketLosses: number;
  /** Total amount committed to markets */
  totalMarketCommitments: number;
  /** Total winnings from markets */
  totalMarketWinnings: number;
  /** Is this agent an oracle? */
  isOracle: boolean;
  /** Number of markets resolved as oracle */
  oracleResolutions: number;
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
// Simulation Context (used by market-workflows.ts)
// ============================================================================

export interface SimulationContext {
  /** Current tick/cycle number */
  generation: number;
  /** Market conditions modifier (0-1) */
  marketHealth: number;
  /** Base fitness required for activity */
  activityThreshold: number;
  /** Mutation probability (0-1) */
  mutationRate: number;
}
