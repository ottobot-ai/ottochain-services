/**
 * Workflow Definitions
 * 
 * Imports state machine definitions from @ottochain/sdk.
 * Traffic-gen creates fibers using SDK definitions and drives transitions.
 */

import { getIdentityDefinition } from '@ottochain/sdk/apps/identity';
import { getContractDefinition } from '@ottochain/sdk/apps/contracts';
import { getMarketDefinition } from '@ottochain/sdk/apps/markets';
import { getGovernanceDefinition } from '@ottochain/sdk/apps/governance';

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowType = 
  | 'AgentIdentity'
  | 'Contract'
  | 'Escrow'
  | 'PredictionMarket'
  | 'Auction'
  | 'Crowdfund'
  | 'GroupBuy'
  | 'DAO';

export interface WorkflowDefinition {
  type: WorkflowType;
  name: string;
  description: string;
  minParticipants: number;
  maxParticipants: number;
  states: string[];
  finalStates: string[];
  transitions: WorkflowTransition[];
  expectedDuration: number;
  frequency: number;
  stateMachineDefinition: Record<string, unknown>;
  initialDataFn: (ctx: CreateContext) => Record<string, unknown>;
}

export interface CreateContext {
  fiberId: string;
  participants: string[];
  ownerAddress: string;
  generation: number;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  event: string;
  actor: 'owner' | 'counterparty' | 'any' | 'third_party';
  weight: number;
  payloadFn?: (ctx: TransitionContext) => Record<string, unknown>;
}

export interface TransitionContext {
  fiberId: string;
  currentState: string;
  participants: string[];
  ownerAddress: string;
  generation: number;
  timestamp: number;
}

// ============================================================================
// SDK Definitions
// ============================================================================

const IDENTITY_AGENT_DEF = getIdentityDefinition('agent') as Record<string, unknown>;
const CONTRACT_AGREEMENT_DEF = getContractDefinition('agreement') as Record<string, unknown>;
const CONTRACT_ESCROW_DEF = getContractDefinition('escrow') as Record<string, unknown>;
const MARKET_PREDICTION_DEF = getMarketDefinition('prediction') as Record<string, unknown>;
const MARKET_AUCTION_DEF = getMarketDefinition('auction') as Record<string, unknown>;
const MARKET_CROWDFUND_DEF = getMarketDefinition('crowdfund') as Record<string, unknown>;
const MARKET_GROUPBUY_DEF = getMarketDefinition('groupBuy') as Record<string, unknown>;
const DAO_MULTISIG_DEF = getGovernanceDefinition('daoMultisig') as Record<string, unknown>;

// ============================================================================
// Workflow Definitions
// ============================================================================

export const AGENT_IDENTITY_WORKFLOW: WorkflowDefinition = {
  type: 'AgentIdentity',
  name: 'Agent Identity',
  description: 'Agent registration and reputation tracking',
  minParticipants: 1,
  maxParticipants: 1,
  states: ['REGISTERED', 'ACTIVE', 'CHALLENGED', 'SUSPENDED', 'WITHDRAWN'],
  finalStates: ['WITHDRAWN'],
  transitions: [
    { from: 'REGISTERED', to: 'ACTIVE', event: 'activate', actor: 'owner', weight: 1.0 },
    { from: 'ACTIVE', to: 'ACTIVE', event: 'receive_vouch', actor: 'third_party', weight: 0.6 },
    { from: 'ACTIVE', to: 'ACTIVE', event: 'receive_completion', actor: 'any', weight: 0.7 },
    { from: 'ACTIVE', to: 'CHALLENGED', event: 'challenge', actor: 'third_party', weight: 0.05 },
    { from: 'CHALLENGED', to: 'ACTIVE', event: 'defend', actor: 'owner', weight: 0.8 },
    { from: 'CHALLENGED', to: 'SUSPENDED', event: 'fail_challenge', actor: 'any', weight: 0.2 },
    { from: 'SUSPENDED', to: 'ACTIVE', event: 'reinstate', actor: 'owner', weight: 0.5 },
    { from: 'ACTIVE', to: 'WITHDRAWN', event: 'withdraw', actor: 'owner', weight: 0.02 },
  ],
  expectedDuration: 10,
  frequency: 3,
  stateMachineDefinition: IDENTITY_AGENT_DEF,
  initialDataFn: (ctx) => ({
    schema: 'AgentIdentity',
    agentId: ctx.fiberId,
    ownerAddress: ctx.ownerAddress,
    platform: 'traffic-gen',
    displayName: `Agent-${ctx.fiberId.slice(0, 8)}`,
    reputation: { score: 0, vouches: 0, completions: 0, challenges: 0, lastUpdated: Date.now() },
    createdAt: new Date().toISOString(),
  }),
};

export const CONTRACT_WORKFLOW: WorkflowDefinition = {
  type: 'Contract',
  name: 'Contract Agreement',
  description: 'Two-party contract agreement',
  minParticipants: 2,
  maxParticipants: 2,
  states: ['PROPOSED', 'ACTIVE', 'COMPLETED', 'DISPUTED', 'REJECTED', 'CANCELLED'],
  finalStates: ['COMPLETED', 'REJECTED', 'CANCELLED'],
  transitions: [
    { from: 'PROPOSED', to: 'ACTIVE', event: 'accept', actor: 'counterparty', weight: 0.7 },
    { from: 'PROPOSED', to: 'REJECTED', event: 'reject', actor: 'counterparty', weight: 0.2 },
    { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'ACTIVE', to: 'COMPLETED', event: 'complete', actor: 'any', weight: 0.8 },
    { from: 'ACTIVE', to: 'DISPUTED', event: 'dispute', actor: 'any', weight: 0.15 },
    { from: 'DISPUTED', to: 'COMPLETED', event: 'resolve', actor: 'any', weight: 0.7 },
    { from: 'DISPUTED', to: 'CANCELLED', event: 'cancel', actor: 'any', weight: 0.3 },
  ],
  expectedDuration: 5,
  frequency: 4,
  stateMachineDefinition: CONTRACT_AGREEMENT_DEF,
  initialDataFn: (ctx) => ({
    schema: 'ContractAgreement',
    contractId: ctx.fiberId,
    proposer: ctx.ownerAddress,
    counterparty: ctx.participants[1] || null,
    terms: { description: `Test contract ${ctx.fiberId.slice(0, 8)}`, value: Math.floor(Math.random() * 1000) },
    createdAt: new Date().toISOString(),
  }),
};

export const ESCROW_WORKFLOW: WorkflowDefinition = {
  type: 'Escrow',
  name: 'Token Escrow',
  description: 'Three-party escrow with dispute resolution',
  minParticipants: 3,
  maxParticipants: 3,
  states: ['CREATED', 'FUNDED', 'ACTIVE', 'RELEASING', 'DISPUTED', 'RELEASED', 'REFUNDED', 'SPLIT'],
  finalStates: ['RELEASED', 'REFUNDED', 'SPLIT'],
  transitions: [
    { from: 'CREATED', to: 'FUNDED', event: 'fund', actor: 'owner', weight: 0.9 },
    { from: 'CREATED', to: 'REFUNDED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'FUNDED', to: 'ACTIVE', event: 'activate', actor: 'counterparty', weight: 0.85 },
    { from: 'ACTIVE', to: 'RELEASING', event: 'request_release', actor: 'counterparty', weight: 0.7 },
    { from: 'ACTIVE', to: 'DISPUTED', event: 'dispute', actor: 'any', weight: 0.2 },
    { from: 'RELEASING', to: 'RELEASED', event: 'approve_release', actor: 'owner', weight: 0.8 },
    { from: 'RELEASING', to: 'DISPUTED', event: 'dispute', actor: 'owner', weight: 0.2 },
    { from: 'DISPUTED', to: 'RELEASED', event: 'rule_beneficiary', actor: 'third_party', weight: 0.4 },
    { from: 'DISPUTED', to: 'REFUNDED', event: 'rule_depositor', actor: 'third_party', weight: 0.3 },
    { from: 'DISPUTED', to: 'SPLIT', event: 'rule_split', actor: 'third_party', weight: 0.3 },
  ],
  expectedDuration: 8,
  frequency: 2,
  stateMachineDefinition: CONTRACT_ESCROW_DEF,
  initialDataFn: (ctx) => ({
    schema: 'ContractEscrow',
    escrowId: ctx.fiberId,
    depositor: ctx.ownerAddress,
    beneficiary: ctx.participants[1] || null,
    arbiter: ctx.participants[2] || null,
    amount: Math.floor(Math.random() * 10000) + 100,
    createdAt: new Date().toISOString(),
  }),
};

export const PREDICTION_MARKET_WORKFLOW: WorkflowDefinition = {
  type: 'PredictionMarket',
  name: 'Prediction Market',
  description: 'Binary or multi-outcome prediction market',
  minParticipants: 1,
  maxParticipants: 100,
  states: ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'],
  finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
  transitions: [
    { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'owner', weight: 0.9 },
    { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'OPEN', to: 'OPEN', event: 'commit', actor: 'any', weight: 0.6, payloadFn: (ctx) => ({ outcome: Math.random() > 0.5 ? 'YES' : 'NO', amount: Math.floor(Math.random() * 100) + 1 }) },
    { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'owner', weight: 0.3 },
    { from: 'CLOSED', to: 'RESOLVING', event: 'start_resolution', actor: 'owner', weight: 0.8 },
    { from: 'RESOLVING', to: 'SETTLED', event: 'resolve', actor: 'third_party', weight: 0.9, payloadFn: () => ({ outcome: Math.random() > 0.5 ? 'YES' : 'NO' }) },
    { from: 'RESOLVING', to: 'REFUNDED', event: 'refund', actor: 'owner', weight: 0.1 },
  ],
  expectedDuration: 15,
  frequency: 3,
  stateMachineDefinition: MARKET_PREDICTION_DEF,
  initialDataFn: (ctx) => ({
    schema: 'MarketPrediction',
    marketId: ctx.fiberId,
    creator: ctx.ownerAddress,
    question: `Will event ${ctx.fiberId.slice(0, 8)} happen?`,
    outcomes: ['YES', 'NO'],
    deadline: Date.now() + 86400000,
    createdAt: new Date().toISOString(),
  }),
};

export const AUCTION_WORKFLOW: WorkflowDefinition = {
  type: 'Auction',
  name: 'Auction',
  description: 'Ascending price auction',
  minParticipants: 1,
  maxParticipants: 50,
  states: ['PROPOSED', 'OPEN', 'CLOSED', 'SETTLED', 'CANCELLED'],
  finalStates: ['SETTLED', 'CANCELLED'],
  transitions: [
    { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'owner', weight: 0.9 },
    { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'OPEN', to: 'OPEN', event: 'bid', actor: 'any', weight: 0.7, payloadFn: (ctx) => ({ amount: Math.floor(Math.random() * 1000) + 100 }) },
    { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'owner', weight: 0.3 },
    { from: 'CLOSED', to: 'SETTLED', event: 'settle', actor: 'owner', weight: 0.95 },
    { from: 'CLOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.05 },
  ],
  expectedDuration: 10,
  frequency: 2,
  stateMachineDefinition: MARKET_AUCTION_DEF,
  initialDataFn: (ctx) => ({
    schema: 'MarketAuction',
    auctionId: ctx.fiberId,
    seller: ctx.ownerAddress,
    item: `Item-${ctx.fiberId.slice(0, 8)}`,
    reservePrice: Math.floor(Math.random() * 100) + 10,
    deadline: Date.now() + 3600000,
    createdAt: new Date().toISOString(),
  }),
};

export const CROWDFUND_WORKFLOW: WorkflowDefinition = {
  type: 'Crowdfund',
  name: 'Crowdfund Campaign',
  description: 'All-or-nothing crowdfunding',
  minParticipants: 1,
  maxParticipants: 100,
  states: ['PROPOSED', 'OPEN', 'CLOSED', 'SETTLED', 'REFUNDED', 'CANCELLED'],
  finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
  transitions: [
    { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'owner', weight: 0.9 },
    { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'OPEN', to: 'OPEN', event: 'pledge', actor: 'any', weight: 0.6, payloadFn: () => ({ amount: Math.floor(Math.random() * 500) + 10 }) },
    { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'owner', weight: 0.3 },
    { from: 'CLOSED', to: 'SETTLED', event: 'finalize', actor: 'owner', weight: 0.7 },
    { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'owner', weight: 0.3 },
  ],
  expectedDuration: 12,
  frequency: 2,
  stateMachineDefinition: MARKET_CROWDFUND_DEF,
  initialDataFn: (ctx) => ({
    schema: 'MarketCrowdfund',
    campaignId: ctx.fiberId,
    creator: ctx.ownerAddress,
    title: `Campaign ${ctx.fiberId.slice(0, 8)}`,
    goal: Math.floor(Math.random() * 10000) + 1000,
    deadline: Date.now() + 604800000,
    createdAt: new Date().toISOString(),
  }),
};

export const GROUPBUY_WORKFLOW: WorkflowDefinition = {
  type: 'GroupBuy',
  name: 'Group Buy',
  description: 'Collective purchasing with volume discounts',
  minParticipants: 1,
  maxParticipants: 50,
  states: ['PROPOSED', 'OPEN', 'CLOSED', 'SETTLED', 'REFUNDED', 'CANCELLED'],
  finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
  transitions: [
    { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'owner', weight: 0.9 },
    { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'owner', weight: 0.1 },
    { from: 'OPEN', to: 'OPEN', event: 'join', actor: 'any', weight: 0.6, payloadFn: () => ({ units: Math.floor(Math.random() * 10) + 1 }) },
    { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'owner', weight: 0.3 },
    { from: 'CLOSED', to: 'SETTLED', event: 'fulfill', actor: 'owner', weight: 0.8 },
    { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'owner', weight: 0.2 },
  ],
  expectedDuration: 10,
  frequency: 1,
  stateMachineDefinition: MARKET_GROUPBUY_DEF,
  initialDataFn: (ctx) => ({
    schema: 'MarketGroupBuy',
    groupBuyId: ctx.fiberId,
    organizer: ctx.ownerAddress,
    product: `Product-${ctx.fiberId.slice(0, 8)}`,
    unitPrice: Math.floor(Math.random() * 100) + 20,
    minUnits: 10,
    deadline: Date.now() + 259200000,
    createdAt: new Date().toISOString(),
  }),
};

export const DAO_WORKFLOW: WorkflowDefinition = {
  type: 'DAO',
  name: 'Multisig DAO',
  description: 'Multi-signature DAO governance',
  minParticipants: 3,
  maxParticipants: 10,
  states: ['ACTIVE', 'PROPOSAL_PENDING', 'EXECUTED'],
  finalStates: [],
  transitions: [
    { from: 'ACTIVE', to: 'PROPOSAL_PENDING', event: 'propose', actor: 'any', weight: 0.4, payloadFn: () => ({ title: `Proposal ${Date.now()}`, description: 'Test proposal' }) },
    { from: 'PROPOSAL_PENDING', to: 'PROPOSAL_PENDING', event: 'sign', actor: 'any', weight: 0.6 },
    { from: 'PROPOSAL_PENDING', to: 'ACTIVE', event: 'execute', actor: 'any', weight: 0.3 },
    { from: 'PROPOSAL_PENDING', to: 'ACTIVE', event: 'cancel', actor: 'owner', weight: 0.1 },
  ],
  expectedDuration: 20,
  frequency: 1,
  stateMachineDefinition: DAO_MULTISIG_DEF,
  initialDataFn: (ctx) => ({
    schema: 'MultisigDAO',
    daoId: ctx.fiberId,
    name: `DAO-${ctx.fiberId.slice(0, 8)}`,
    signers: ctx.participants,
    threshold: Math.min(2, ctx.participants.length),
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Exports
// ============================================================================

export const ALL_WORKFLOWS: WorkflowDefinition[] = [
  AGENT_IDENTITY_WORKFLOW,
  CONTRACT_WORKFLOW,
  ESCROW_WORKFLOW,
  PREDICTION_MARKET_WORKFLOW,
  AUCTION_WORKFLOW,
  CROWDFUND_WORKFLOW,
  GROUPBUY_WORKFLOW,
  DAO_WORKFLOW,
];

export function getWorkflowByType(type: WorkflowType): WorkflowDefinition | undefined {
  return ALL_WORKFLOWS.find(w => w.type === type);
}

export function selectRandomWorkflow(): WorkflowDefinition {
  const totalFrequency = ALL_WORKFLOWS.reduce((sum, w) => sum + w.frequency, 0);
  let random = Math.random() * totalFrequency;
  
  for (const workflow of ALL_WORKFLOWS) {
    random -= workflow.frequency;
    if (random <= 0) {
      return workflow;
    }
  }
  
  return ALL_WORKFLOWS[0];
}
