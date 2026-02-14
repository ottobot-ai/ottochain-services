// Governance types for Bridge API
// Aligns with OttoChain DAO and Governance state machines

// ============================================================================
// Core Types
// ============================================================================

export type DAOType = 'Single' | 'Multisig' | 'Threshold' | 'Token';
export type GovernanceType = 'Legislature' | 'Executive' | 'Judiciary' | 'Constitution' | 'Simple';
export type ProposalStatus = 'PROPOSED' | 'DISCUSSION' | 'VOTING' | 'PENDING' | 'QUEUED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'VETOED';
export type VoteChoice = 'For' | 'Against' | 'Abstain';

// ============================================================================
// Request Types
// ============================================================================

export interface CreateProposalRequest {
  privateKey: string;
  daoId: string;
  title: string;
  description?: string;
  actionType?: string;
  payload?: Record<string, unknown>;
}

export interface SubmitProposalRequest {
  privateKey: string;
  proposalId: string;
}

export interface VoteRequest {
  privateKey: string;
  proposalId: string;
  vote: VoteChoice;
  weight?: number;
}

export interface QueueProposalRequest {
  privateKey: string;
  proposalId: string;
}

export interface ExecuteProposalRequest {
  privateKey: string;
  proposalId: string;
}

export interface DelegateVotingPowerRequest {
  privateKey: string;
  daoId: string;
  delegateTo: string;
  weight?: number;
}

// ============================================================================
// Response Types
// ============================================================================

export interface ProposalDetails {
  id: string;
  daoId: string;
  title: string;
  description?: string;
  status: ProposalStatus;
  proposer: string;
  actionType?: string;
  payload?: Record<string, unknown>;
  votes?: Record<string, { choice: VoteChoice; weight: number; timestamp: string }>;
  createdAt: string;
  submittedAt?: string;
  votingEndsAt?: string;
  queuedAt?: string;
  executedAt?: string;
  rejectedAt?: string;
  vetoedAt?: string;
}

export interface ProposalListItem {
  id: string;
  daoId: string;
  title: string;
  status: ProposalStatus;
  proposer: string;
  createdAt: string;
  votingEndsAt?: string;
}

export interface VotingPower {
  address: string;
  daoId: string;
  directPower: number;
  delegatedPower: number;
  totalPower: number;
  delegations?: Array<{
    from: string;
    weight: number;
    timestamp: string;
  }>;
}

export interface TreasuryStatus {
  daoId: string;
  assets: Array<{
    tokenId?: string;
    balance: number;
    decimals?: number;
    symbol?: string;
  }>;
  totalValueUSD?: number;
  lastUpdated: string;
}

export interface DAOMetadata {
  id: string;
  name: string;
  description?: string;
  type: DAOType;
  createdBy: string;
  createdAt: string;
  status: 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  votingPeriodMs: number;
  passingThreshold: number;
  quorum?: number;
  proposalThreshold?: number;
  memberCount?: number;
}

// ============================================================================
// Query Parameters
// ============================================================================

export interface ProposalListQuery {
  daoId?: string;
  status?: ProposalStatus;
  proposer?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'votingEndsAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Internal Types for State Machine Integration
// ============================================================================

export interface GovernanceStateData {
  schema: string;
  name: string;
  description?: string;
  proposal?: {
    id: string;
    title: string;
    description?: string;
    proposer: string;
    actionType?: string;
    payload?: Record<string, unknown>;
    createdAt: string;
    submittedAt?: string;
  };
  votes?: Record<string, { choice: string; weight: number; timestamp: string }>;
  delegations?: Record<string, { delegateTo: string; weight: number; timestamp: string }>;
  executedProposals?: ProposalDetails[];
  rejectedProposals?: ProposalDetails[];
  cancelledProposals?: ProposalDetails[];
  vetoedProposals?: ProposalDetails[];
  admins?: string[];
  proposers?: string[];
  vetoers?: string[];
  executors?: string[];
  votingPeriodMs?: number;
  vetoPeriodMs?: number;
  passingThreshold?: number;
  quorum?: number;
  proposalThreshold?: number;
  allowDelegation?: boolean;
  status: string;
  metadata?: {
    createdBy: string;
    createdAt: string;
    [key: string]: unknown;
  };
}

export interface MultisigDAOStateData {
  schema: 'MultisigDAO';
  name: string;
  description?: string;
  signers: string[];
  threshold: number;
  proposal?: {
    id: string;
    title: string;
    description?: string;
    proposer: string;
    actionType?: string;
    payload?: Record<string, unknown>;
    createdAt: string;
  };
  signatures?: Record<string, { timestamp: string }>;
  actions?: ProposalDetails[];
  cancelledProposals?: ProposalDetails[];
  proposalTTLMs?: number;
  status: string;
  metadata?: {
    createdBy: string;
    createdAt: string;
    [key: string]: unknown;
  };
}

export interface TokenDAOStateData {
  schema: 'TokenDAO';
  name: string;
  description?: string;
  tokenId: string;
  balances?: Record<string, number>;
  delegations?: Record<string, { delegateTo: string; weight: number; timestamp: string }>;
  proposal?: {
    id: string;
    title: string;
    description?: string;
    proposer: string;
    actionType?: string;
    payload?: Record<string, unknown>;
    createdAt: string;
    submittedAt?: string;
  };
  votes?: Record<string, { choice: string; weight: number; timestamp: string }>;
  executedProposals?: ProposalDetails[];
  rejectedProposals?: ProposalDetails[];
  cancelledProposals?: ProposalDetails[];
  proposalThreshold?: number;
  votingPeriodMs?: number;
  timelockMs?: number;
  quorum?: number;
  status: string;
  metadata?: {
    createdBy: string;
    createdAt: string;
    [key: string]: unknown;
  };
}

// Union type for all DAO state data variants
export type DAOStateData = GovernanceStateData | MultisigDAOStateData | TokenDAOStateData;