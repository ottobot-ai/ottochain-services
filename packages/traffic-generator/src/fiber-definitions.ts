/**
 * Fiber Definitions for Traffic Generator
 * 
 * Defines workflow templates with roles and transitions
 * for weighted traffic generation.
 * 
 * Based on OttoChain SDK application layer:
 * - AgentIdentity (ottochain.apps.identity.v1)
 * - Contract (ottochain.apps.contracts.v1)
 * - Custom fiber types (TicTacToe, Voting, etc.)
 */

export interface TransitionDef {
  from: string;
  to: string;
  event: string;
  actor: string; // role name
}

export interface FiberDefinition {
  type: string;
  name: string;
  /** SDK workflowType - determines which UI view shows it */
  workflowType: 'Contract' | 'AgentIdentity' | 'Custom' | 'Market' | 'DAO' | 'Governance';
  roles: string[];  // e.g., ['proposer', 'counterparty'] or ['playerX', 'playerO']
  isVariableParty: boolean;  // true for voting, multi-sig
  /** Contract states from SDK: PROPOSED → ACTIVE → COMPLETED/REJECTED/DISPUTED */
  states: string[];
  initialState: string;
  finalStates: string[];
  transitions: TransitionDef[];
  /** Market type for Market workflows */
  marketType?: 'prediction' | 'auction' | 'crowdfund' | 'group_buy';
  /** DAO type for DAO workflows */
  daoType?: 'token' | 'multisig' | 'threshold';
  /** Generate initial stateData for this fiber type */
  generateStateData: (participants: Map<string, string>, context: FiberContext) => ContractStateData | CustomStateData | MarketStateData | DAOStateData | GovernanceStateData;
}

export interface FiberContext {
  fiberId: string;
  generation: number;
}

/** Contract stateData matching SDK schema (ottochain.apps.contracts.v1) */
export interface ContractStateData {
  contractId?: string;
  proposer: string;
  counterparty: string;
  state: string;
  terms: {
    description: string;
    value?: number;
    currency?: string;
    deadline?: string;
    [key: string]: unknown;
  };
  proposedAt: string;
  acceptedAt?: string;
  completedAt?: string;
  completionProof?: string;
  arbiter?: string;  // For arbitrated contracts
}

/** Custom fiber stateData (games, voting, etc.) */
export interface CustomStateData {
  [key: string]: unknown;
}

/** Market fiber stateData */
export interface MarketStateData {
  schema: 'Market';
  marketType: 'prediction' | 'auction' | 'crowdfund' | 'group_buy';
  creator: string;
  oracles: string[];
  quorum: number;
  deadline: number | null;
  commitments: Record<string, { amount: number; data: Record<string, unknown> }>;
  totalCommitted: number;
  resolutions: Array<{ oracle: string; outcome: string | number }>;
  claims: Record<string, number>;
  status: string;
  title: string;
  description: string;
  threshold: number | null;
  terms: Record<string, unknown>;
}

/** DAO fiber stateData */
export interface DAOStateData {
  schema: 'DAO';
  daoType: 'token' | 'multisig' | 'threshold';
  name: string;
  creator: string;
  members: string[];
  // Token DAO specific
  balances?: Record<string, number>;
  delegations?: Record<string, string>;
  proposalThreshold?: number;
  votingPeriodMs?: number;
  timelockMs?: number;
  quorum?: number;
  // Multisig specific
  signers?: string[];
  threshold?: number;
  proposalTTLMs?: number;
  signatures?: Record<string, number>;
  // Threshold DAO specific
  memberThreshold?: number;
  voteThreshold?: number;
  proposeThreshold?: number;
  // Common
  proposal: {
    id: string;
    title: string;
    description: string;
    actionType: string;
    payload: Record<string, unknown>;
    proposer: string;
    proposedAt: number;
    deadline?: number;
  } | null;
  votes: Record<string, { vote: string; weight?: number; votedAt: number }>;
  executedProposals: Array<Record<string, unknown>>;
  status: string;
  createdAt: number;
}

/** Governance fiber stateData */
export interface GovernanceStateData {
  schema: 'Governance';
  name: string;
  creator: string;
  admins: string[];
  members: Record<string, { role: string; addedAt: number }>;
  rules: Record<string, unknown>;
  votingPeriodMs: number;
  passingThreshold: number;
  disputeQuorum: number;
  proposal: {
    id: string;
    type: string;
    changes: Record<string, unknown>;
    proposer: string;
    proposedAt: number;
    deadline: number;
  } | null;
  dispute: {
    id: string;
    plaintiff: string;
    defendant: string;
    claim: string;
    filedAt: number;
    evidence: Array<{ from: string; content: string; at: number }>;
  } | null;
  votes: Record<string, { vote?: string; ruling?: string; votedAt: number }>;
  history: Array<Record<string, unknown>>;
  status: string;
  createdAt: number;
}

/** Sample contract terms generators */
const SAMPLE_TERMS = {
  escrow: [
    { description: 'Website development project', value: 500, currency: 'OTTO' },
    { description: 'Logo design and branding', value: 150, currency: 'OTTO' },
    { description: 'Smart contract audit', value: 1000, currency: 'OTTO' },
    { description: 'API integration work', value: 300, currency: 'OTTO' },
    { description: 'Documentation writing', value: 200, currency: 'OTTO' },
  ],
  order: [
    { description: 'Digital art NFT', value: 50, currency: 'OTTO' },
    { description: 'Premium subscription (1 month)', value: 25, currency: 'OTTO' },
    { description: 'Data analysis report', value: 100, currency: 'OTTO' },
  ],
  game: [
    { description: 'Tic-Tac-Toe match', value: 10, currency: 'OTTO', wager: true },
  ],
  prediction: [
    { question: 'Will ETH hit $5000 by end of month?', outcomes: ['YES', 'NO'], feePercent: 2 },
    { question: 'Will project X ship by deadline?', outcomes: ['YES', 'NO'], feePercent: 2 },
    { question: 'Will token Y get listed on major exchange?', outcomes: ['YES', 'NO'], feePercent: 3 },
  ],
  auction: [
    { item: 'Rare digital collectible #1', reservePrice: 50, buyNowPrice: 200 },
    { item: 'Premium domain name', reservePrice: 100, buyNowPrice: 500 },
    { item: 'Limited edition artwork', reservePrice: 75, buyNowPrice: 300 },
  ],
  crowdfund: [
    { goal: 500, rewards: [{ tier: 'supporter', minAmount: 10 }, { tier: 'backer', minAmount: 50 }], allOrNothing: true },
    { goal: 1000, rewards: [{ tier: 'bronze', minAmount: 25 }, { tier: 'silver', minAmount: 100 }, { tier: 'gold', minAmount: 250 }], allOrNothing: true },
  ],
  groupBuy: [
    { product: 'Hardware wallet bulk order', unitPrice: 50, bulkPrice: 35, minUnits: 10 },
    { product: 'Developer tool license', unitPrice: 100, bulkPrice: 70, minUnits: 5 },
  ],
  tokenDAO: [
    { name: 'Protocol Treasury DAO', tokenId: 'OTTO', proposalThreshold: 1000, quorum: 10000, votingPeriodDays: 3 },
    { name: 'Community Fund DAO', tokenId: 'OTTO', proposalThreshold: 500, quorum: 5000, votingPeriodDays: 5 },
    { name: 'Development Grants DAO', tokenId: 'DEV', proposalThreshold: 100, quorum: 1000, votingPeriodDays: 7 },
  ],
  multisigDAO: [
    { name: 'Core Team Multisig', requiredSigners: 3, totalSigners: 5, proposalTTLDays: 7 },
    { name: 'Emergency Response Multisig', requiredSigners: 2, totalSigners: 3, proposalTTLDays: 1 },
    { name: 'Partnership Multisig', requiredSigners: 4, totalSigners: 7, proposalTTLDays: 14 },
  ],
  thresholdDAO: [
    { name: 'Contributor DAO', memberThreshold: 20, voteThreshold: 30, proposeThreshold: 50, quorum: 3 },
    { name: 'Expert Council', memberThreshold: 50, voteThreshold: 60, proposeThreshold: 80, quorum: 5 },
    { name: 'Open Community DAO', memberThreshold: 10, voteThreshold: 15, proposeThreshold: 25, quorum: 10 },
  ],
  governance: [
    { name: 'Project Governance', passingThreshold: 0.5, disputeQuorum: 3, votingPeriodDays: 7 },
    { name: 'Guild Governance', passingThreshold: 0.6, disputeQuorum: 5, votingPeriodDays: 5 },
    { name: 'DAO Governance', passingThreshold: 0.67, disputeQuorum: 7, votingPeriodDays: 14 },
  ],
};

function randomTerms<K extends keyof typeof SAMPLE_TERMS>(category: K): (typeof SAMPLE_TERMS)[K][number] {
  const options = SAMPLE_TERMS[category];
  return options[Math.floor(Math.random() * options.length)];
}

function futureDeadline(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export const FIBER_DEFINITIONS: Record<string, FiberDefinition> = {
  /**
   * Simple Escrow - 2-party contract
   * Proposer (buyer) creates, counterparty (seller) accepts and delivers
   */
  escrow: {
    type: 'escrow',
    name: 'Simple Escrow',
    workflowType: 'Contract',
    roles: ['proposer', 'counterparty'],
    isVariableParty: false,
    states: ['PROPOSED', 'ACTIVE', 'DELIVERED', 'COMPLETED', 'REJECTED', 'DISPUTED'],
    initialState: 'PROPOSED',
    finalStates: ['COMPLETED', 'REJECTED'],
    transitions: [
      { from: 'PROPOSED', to: 'ACTIVE', event: 'accept', actor: 'counterparty' },
      { from: 'PROPOSED', to: 'REJECTED', event: 'reject', actor: 'counterparty' },
      { from: 'ACTIVE', to: 'DELIVERED', event: 'deliver', actor: 'counterparty' },
      { from: 'DELIVERED', to: 'COMPLETED', event: 'confirm', actor: 'proposer' },
      { from: 'DELIVERED', to: 'DISPUTED', event: 'dispute', actor: 'proposer' },
    ],
    generateStateData: (participants, ctx) => {
      const terms = randomTerms('escrow');
      return {
        contractId: `ESC-${ctx.fiberId.slice(0, 8)}`,
        proposer: participants.get('proposer')!,
        counterparty: participants.get('counterparty')!,
        state: 'PROPOSED',
        terms: {
          ...terms,
          deadline: futureDeadline(7),
        },
        proposedAt: new Date().toISOString(),
      };
    },
  },

  /**
   * Arbitrated Escrow - 3-party contract with dispute resolution
   */
  arbitratedEscrow: {
    type: 'arbitratedEscrow',
    name: 'Escrow with Arbiter',
    workflowType: 'Contract',
    roles: ['proposer', 'counterparty', 'arbiter'],
    isVariableParty: false,
    states: ['PROPOSED', 'ACTIVE', 'DELIVERED', 'COMPLETED', 'REJECTED', 'DISPUTED', 'RESOLVED'],
    initialState: 'PROPOSED',
    finalStates: ['COMPLETED', 'REJECTED', 'RESOLVED'],
    transitions: [
      { from: 'PROPOSED', to: 'ACTIVE', event: 'accept', actor: 'counterparty' },
      { from: 'PROPOSED', to: 'REJECTED', event: 'reject', actor: 'counterparty' },
      { from: 'ACTIVE', to: 'DELIVERED', event: 'deliver', actor: 'counterparty' },
      { from: 'DELIVERED', to: 'COMPLETED', event: 'confirm', actor: 'proposer' },
      { from: 'DELIVERED', to: 'DISPUTED', event: 'dispute', actor: 'proposer' },
      { from: 'DISPUTED', to: 'RESOLVED', event: 'resolve', actor: 'arbiter' },
    ],
    generateStateData: (participants, ctx) => {
      const terms = randomTerms('escrow');
      return {
        contractId: `ARB-${ctx.fiberId.slice(0, 8)}`,
        proposer: participants.get('proposer')!,
        counterparty: participants.get('counterparty')!,
        arbiter: participants.get('arbiter')!,
        state: 'PROPOSED',
        terms: {
          ...terms,
          deadline: futureDeadline(14),
          arbiterFee: Math.floor(terms.value * 0.05), // 5% arbiter fee
        },
        proposedAt: new Date().toISOString(),
      };
    },
  },

  /**
   * Simple Order - 2-party purchase contract
   */
  simpleOrder: {
    type: 'simpleOrder',
    name: 'Simple Order',
    workflowType: 'Contract',
    roles: ['proposer', 'counterparty'],
    isVariableParty: false,
    states: ['PROPOSED', 'CONFIRMED', 'SHIPPED', 'COMPLETED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['COMPLETED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'CONFIRMED', event: 'confirm', actor: 'counterparty' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'proposer' },
      { from: 'CONFIRMED', to: 'SHIPPED', event: 'ship', actor: 'counterparty' },
      { from: 'SHIPPED', to: 'COMPLETED', event: 'receive', actor: 'proposer' },
    ],
    generateStateData: (participants, ctx) => {
      const terms = randomTerms('order');
      return {
        contractId: `ORD-${ctx.fiberId.slice(0, 8)}`,
        proposer: participants.get('proposer')!,
        counterparty: participants.get('counterparty')!,
        state: 'PROPOSED',
        terms: {
          ...terms,
          deadline: futureDeadline(3),
        },
        proposedAt: new Date().toISOString(),
      };
    },
  },

  /**
   * Tic-Tac-Toe - 2-player game (Custom fiber, not Contract)
   */
  ticTacToe: {
    type: 'ticTacToe',
    name: 'Tic-Tac-Toe Game',
    workflowType: 'Custom',
    roles: ['playerX', 'playerO'],
    isVariableParty: false,
    states: ['WAITING', 'X_TURN', 'O_TURN', 'X_WINS', 'O_WINS', 'DRAW'],
    initialState: 'WAITING',
    finalStates: ['X_WINS', 'O_WINS', 'DRAW'],
    transitions: [
      { from: 'WAITING', to: 'X_TURN', event: 'start', actor: 'playerO' },
      { from: 'X_TURN', to: 'O_TURN', event: 'move', actor: 'playerX' },
      { from: 'O_TURN', to: 'X_TURN', event: 'move', actor: 'playerO' },
      { from: 'X_TURN', to: 'X_WINS', event: 'win', actor: 'playerX' },
      { from: 'O_TURN', to: 'O_WINS', event: 'win', actor: 'playerO' },
      { from: 'X_TURN', to: 'DRAW', event: 'draw', actor: 'playerX' },
      { from: 'O_TURN', to: 'DRAW', event: 'draw', actor: 'playerO' },
    ],
    generateStateData: (participants, ctx) => ({
      gameId: `TTT-${ctx.fiberId.slice(0, 8)}`,
      playerX: participants.get('playerX')!,
      playerO: participants.get('playerO')!,
      board: [null, null, null, null, null, null, null, null, null],
      moveCount: 0,
      wager: randomTerms('game').value,
      startedAt: new Date().toISOString(),
    }),
  },

  /**
   * Multi-Party Vote - N-party decision making
   */
  voting: {
    type: 'voting',
    name: 'Multi-Party Vote',
    workflowType: 'Custom',
    roles: ['proposer', 'voter'],  // voter is variable count
    isVariableParty: true,
    states: ['PROPOSED', 'VOTING', 'PASSED', 'FAILED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['PASSED', 'FAILED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'VOTING', event: 'open', actor: 'proposer' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'proposer' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter' },
      { from: 'VOTING', to: 'PASSED', event: 'tally_pass', actor: 'proposer' },
      { from: 'VOTING', to: 'FAILED', event: 'tally_fail', actor: 'proposer' },
    ],
    generateStateData: (participants, ctx) => ({
      voteId: `VOTE-${ctx.fiberId.slice(0, 8)}`,
      proposer: participants.get('proposer')!,
      voters: Array.from(participants.entries())
        .filter(([role]) => role.startsWith('voter'))
        .map(([, addr]) => addr),
      question: 'Proposal for community decision',
      options: ['Yes', 'No', 'Abstain'],
      votes: {},
      quorum: 0.5,
      deadline: futureDeadline(2),
      createdAt: new Date().toISOString(),
    }),
  },

  /**
   * Approval Workflow - 3-party sequential approval
   */
  approval: {
    type: 'approval',
    name: 'Approval Workflow',
    workflowType: 'Contract',
    roles: ['proposer', 'approver1', 'approver2'],
    isVariableParty: false,
    states: ['DRAFT', 'PENDING_L1', 'PENDING_L2', 'APPROVED', 'REJECTED'],
    initialState: 'DRAFT',
    finalStates: ['APPROVED', 'REJECTED'],
    transitions: [
      { from: 'DRAFT', to: 'PENDING_L1', event: 'submit', actor: 'proposer' },
      { from: 'PENDING_L1', to: 'PENDING_L2', event: 'approve_l1', actor: 'approver1' },
      { from: 'PENDING_L1', to: 'REJECTED', event: 'reject_l1', actor: 'approver1' },
      { from: 'PENDING_L2', to: 'APPROVED', event: 'approve_l2', actor: 'approver2' },
      { from: 'PENDING_L2', to: 'REJECTED', event: 'reject_l2', actor: 'approver2' },
    ],
    generateStateData: (participants, ctx) => ({
      contractId: `APR-${ctx.fiberId.slice(0, 8)}`,
      proposer: participants.get('proposer')!,
      counterparty: participants.get('approver1')!, // First approver as counterparty for UI
      state: 'DRAFT',
      terms: {
        description: 'Multi-level approval request',
        approvalChain: [
          participants.get('approver1')!,
          participants.get('approver2')!,
        ],
      },
      proposedAt: new Date().toISOString(),
    }),
  },

  // =========================================================================
  // Market Workflows
  // =========================================================================

  /**
   * Prediction Market - Multi-party betting on outcomes
   * creator proposes → opens → participants commit → closes → oracle resolves → finalize/claim
   */
  predictionMarket: {
    type: 'predictionMarket',
    name: 'Prediction Market',
    workflowType: 'Market',
    marketType: 'prediction',
    roles: ['creator', 'oracle', 'participant'],
    isVariableParty: true,
    states: ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'creator' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'creator' },
      { from: 'OPEN', to: 'OPEN', event: 'commit', actor: 'participant' },
      { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'creator' },
      { from: 'CLOSED', to: 'RESOLVING', event: 'submit_resolution', actor: 'oracle' },
      { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'RESOLVING', to: 'RESOLVING', event: 'submit_resolution', actor: 'oracle' },
      { from: 'RESOLVING', to: 'SETTLED', event: 'finalize', actor: 'creator' },
      { from: 'RESOLVING', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'SETTLED', to: 'SETTLED', event: 'claim', actor: 'participant' },
    ],
    generateStateData: (participants, ctx): MarketStateData => {
      const terms = randomTerms('prediction');
      return {
        schema: 'Market',
        marketType: 'prediction',
        creator: participants.get('creator')!,
        oracles: [participants.get('oracle')!],
        quorum: 1,
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        status: 'PROPOSED',
        title: `Prediction #${ctx.fiberId.slice(0, 8)}`,
        description: terms.question,
        threshold: null,
        terms,
      };
    },
  },

  /**
   * Auction - Competitive bidding for items
   * creator proposes → opens → bidders commit → closes → determine winner → settle
   */
  auctionMarket: {
    type: 'auctionMarket',
    name: 'Auction',
    workflowType: 'Market',
    marketType: 'auction',
    roles: ['creator', 'oracle', 'participant'],
    isVariableParty: true,
    states: ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'creator' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'creator' },
      { from: 'OPEN', to: 'OPEN', event: 'commit', actor: 'participant' },
      { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'creator' },
      { from: 'CLOSED', to: 'RESOLVING', event: 'submit_resolution', actor: 'oracle' },
      { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'RESOLVING', to: 'SETTLED', event: 'finalize', actor: 'creator' },
      { from: 'RESOLVING', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'SETTLED', to: 'SETTLED', event: 'claim', actor: 'participant' },
    ],
    generateStateData: (participants, ctx): MarketStateData => {
      const terms = randomTerms('auction');
      return {
        schema: 'Market',
        marketType: 'auction',
        creator: participants.get('creator')!,
        oracles: [participants.get('oracle')!],
        quorum: 1,
        deadline: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        status: 'PROPOSED',
        title: `Auction #${ctx.fiberId.slice(0, 8)}`,
        description: `Bidding on: ${terms.item}`,
        threshold: terms.reservePrice,
        terms,
      };
    },
  },

  /**
   * Crowdfunding - Collective funding with threshold
   * creator proposes → opens → backers pledge → closes → check threshold → settle or refund
   */
  crowdfundMarket: {
    type: 'crowdfundMarket',
    name: 'Crowdfunding',
    workflowType: 'Market',
    marketType: 'crowdfund',
    roles: ['creator', 'oracle', 'participant'],
    isVariableParty: true,
    states: ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'creator' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'creator' },
      { from: 'OPEN', to: 'OPEN', event: 'commit', actor: 'participant' },
      { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'creator' },
      { from: 'CLOSED', to: 'RESOLVING', event: 'submit_resolution', actor: 'oracle' },
      { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'RESOLVING', to: 'SETTLED', event: 'finalize', actor: 'creator' },
      { from: 'RESOLVING', to: 'REFUNDED', event: 'refund', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): MarketStateData => {
      const terms = randomTerms('crowdfund');
      return {
        schema: 'Market',
        marketType: 'crowdfund',
        creator: participants.get('creator')!,
        oracles: [participants.get('oracle')!],
        quorum: 1,
        deadline: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        status: 'PROPOSED',
        title: `Crowdfund #${ctx.fiberId.slice(0, 8)}`,
        description: `Funding goal: ${terms.goal} OTTO`,
        threshold: terms.goal,
        terms,
      };
    },
  },

  /**
   * Group Buy - Collective purchasing for bulk discounts
   * creator proposes → opens → buyers order → closes → check min units → settle or refund
   */
  groupBuyMarket: {
    type: 'groupBuyMarket',
    name: 'Group Buy',
    workflowType: 'Market',
    marketType: 'group_buy',
    roles: ['creator', 'oracle', 'participant'],
    isVariableParty: true,
    states: ['PROPOSED', 'OPEN', 'CLOSED', 'RESOLVING', 'SETTLED', 'REFUNDED', 'CANCELLED'],
    initialState: 'PROPOSED',
    finalStates: ['SETTLED', 'REFUNDED', 'CANCELLED'],
    transitions: [
      { from: 'PROPOSED', to: 'OPEN', event: 'open', actor: 'creator' },
      { from: 'PROPOSED', to: 'CANCELLED', event: 'cancel', actor: 'creator' },
      { from: 'OPEN', to: 'OPEN', event: 'commit', actor: 'participant' },
      { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'creator' },
      { from: 'CLOSED', to: 'RESOLVING', event: 'submit_resolution', actor: 'oracle' },
      { from: 'CLOSED', to: 'REFUNDED', event: 'refund', actor: 'creator' },
      { from: 'RESOLVING', to: 'SETTLED', event: 'finalize', actor: 'creator' },
      { from: 'RESOLVING', to: 'REFUNDED', event: 'refund', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): MarketStateData => {
      const terms = randomTerms('groupBuy');
      return {
        schema: 'Market',
        marketType: 'group_buy',
        creator: participants.get('creator')!,
        oracles: [participants.get('oracle')!],
        quorum: 1,
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        status: 'PROPOSED',
        title: `Group Buy #${ctx.fiberId.slice(0, 8)}`,
        description: `Bulk purchase: ${terms.product}`,
        threshold: terms.minUnits * terms.unitPrice,
        terms,
      };
    },
  },

  // =========================================================================
  // DAO Workflows
  // =========================================================================

  /**
   * Token DAO - Token-weighted voting governance
   * creator creates → active → propose → voting → queue/reject → execute/cancel
   */
  tokenDAO: {
    type: 'tokenDAO',
    name: 'Token DAO',
    workflowType: 'DAO',
    daoType: 'token',
    roles: ['creator', 'member', 'delegate'],
    isVariableParty: true,
    states: ['ACTIVE', 'VOTING', 'QUEUED', 'DISSOLVED'],
    initialState: 'ACTIVE',
    finalStates: ['DISSOLVED'],
    transitions: [
      { from: 'ACTIVE', to: 'VOTING', event: 'propose', actor: 'member' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'member' },
      { from: 'VOTING', to: 'QUEUED', event: 'queue', actor: 'creator' },
      { from: 'VOTING', to: 'ACTIVE', event: 'reject', actor: 'creator' },
      { from: 'QUEUED', to: 'ACTIVE', event: 'execute', actor: 'creator' },
      { from: 'QUEUED', to: 'ACTIVE', event: 'cancel', actor: 'member' },
      { from: 'ACTIVE', to: 'ACTIVE', event: 'delegate', actor: 'member' },
      { from: 'ACTIVE', to: 'DISSOLVED', event: 'dissolve', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): DAOStateData => {
      const terms = randomTerms('tokenDAO');
      const members = Array.from(participants.entries())
        .filter(([role]) => role.startsWith('member'))
        .map(([, addr]) => addr);
      
      // Generate random token balances for members
      const balances: Record<string, number> = {};
      for (const member of members) {
        balances[member] = Math.floor(Math.random() * 5000) + 100;
      }
      balances[participants.get('creator')!] = terms.proposalThreshold * 2;
      
      return {
        schema: 'DAO',
        daoType: 'token',
        name: `${terms.name} #${ctx.fiberId.slice(0, 6)}`,
        creator: participants.get('creator')!,
        members: [participants.get('creator')!, ...members],
        balances,
        delegations: {},
        proposalThreshold: terms.proposalThreshold,
        votingPeriodMs: terms.votingPeriodDays * 24 * 60 * 60 * 1000,
        timelockMs: 24 * 60 * 60 * 1000, // 1 day
        quorum: terms.quorum,
        proposal: null,
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

  /**
   * Multisig DAO - N-of-M signature threshold governance
   * creator creates → active → propose → pending → sign → execute/cancel
   */
  multisigDAO: {
    type: 'multisigDAO',
    name: 'Multisig DAO',
    workflowType: 'DAO',
    daoType: 'multisig',
    roles: ['creator', 'signer'],
    isVariableParty: true,
    states: ['ACTIVE', 'PENDING', 'DISSOLVED'],
    initialState: 'ACTIVE',
    finalStates: ['DISSOLVED'],
    transitions: [
      { from: 'ACTIVE', to: 'PENDING', event: 'propose', actor: 'signer' },
      { from: 'PENDING', to: 'PENDING', event: 'sign', actor: 'signer' },
      { from: 'PENDING', to: 'ACTIVE', event: 'execute', actor: 'signer' },
      { from: 'PENDING', to: 'ACTIVE', event: 'cancel', actor: 'signer' },
      { from: 'ACTIVE', to: 'ACTIVE', event: 'add_signer', actor: 'creator' },
      { from: 'ACTIVE', to: 'ACTIVE', event: 'remove_signer', actor: 'creator' },
      { from: 'ACTIVE', to: 'DISSOLVED', event: 'dissolve', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): DAOStateData => {
      const terms = randomTerms('multisigDAO');
      const signers = Array.from(participants.entries())
        .filter(([role]) => role.startsWith('signer'))
        .map(([, addr]) => addr);
      signers.unshift(participants.get('creator')!);
      
      return {
        schema: 'DAO',
        daoType: 'multisig',
        name: `${terms.name} #${ctx.fiberId.slice(0, 6)}`,
        creator: participants.get('creator')!,
        members: signers,
        signers,
        threshold: terms.requiredSigners,
        proposalTTLMs: terms.proposalTTLDays * 24 * 60 * 60 * 1000,
        signatures: {},
        proposal: null,
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

  /**
   * Threshold DAO - Reputation threshold governance
   * creator creates → active → join/leave → propose → voting → execute/reject
   */
  thresholdDAO: {
    type: 'thresholdDAO',
    name: 'Threshold DAO',
    workflowType: 'DAO',
    daoType: 'threshold',
    roles: ['creator', 'member'],
    isVariableParty: true,
    states: ['ACTIVE', 'VOTING', 'DISSOLVED'],
    initialState: 'ACTIVE',
    finalStates: ['DISSOLVED'],
    transitions: [
      { from: 'ACTIVE', to: 'ACTIVE', event: 'join', actor: 'member' },
      { from: 'ACTIVE', to: 'ACTIVE', event: 'leave', actor: 'member' },
      { from: 'ACTIVE', to: 'VOTING', event: 'propose', actor: 'member' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'member' },
      { from: 'VOTING', to: 'ACTIVE', event: 'execute', actor: 'creator' },
      { from: 'VOTING', to: 'ACTIVE', event: 'reject', actor: 'creator' },
      { from: 'ACTIVE', to: 'DISSOLVED', event: 'dissolve', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): DAOStateData => {
      const terms = randomTerms('thresholdDAO');
      const members = Array.from(participants.entries())
        .filter(([role]) => role.startsWith('member'))
        .map(([, addr]) => addr);
      members.unshift(participants.get('creator')!);
      
      return {
        schema: 'DAO',
        daoType: 'threshold',
        name: `${terms.name} #${ctx.fiberId.slice(0, 6)}`,
        creator: participants.get('creator')!,
        members,
        memberThreshold: terms.memberThreshold,
        voteThreshold: terms.voteThreshold,
        proposeThreshold: terms.proposeThreshold,
        quorum: terms.quorum,
        votingPeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        proposal: null,
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

  // =========================================================================
  // Governance Workflows
  // =========================================================================

  /**
   * Simple Governance - Basic org governance with member management and disputes
   * creator creates → active → add/remove members → propose rules → voting → finalize
   * Also handles disputes: file → evidence → vote → resolve
   */
  simpleGovernance: {
    type: 'simpleGovernance',
    name: 'Simple Governance',
    workflowType: 'Governance',
    roles: ['creator', 'admin', 'member'],
    isVariableParty: true,
    states: ['ACTIVE', 'VOTING', 'DISPUTE', 'DISSOLVED'],
    initialState: 'ACTIVE',
    finalStates: ['DISSOLVED'],
    transitions: [
      { from: 'ACTIVE', to: 'ACTIVE', event: 'add_member', actor: 'admin' },
      { from: 'ACTIVE', to: 'ACTIVE', event: 'remove_member', actor: 'admin' },
      { from: 'ACTIVE', to: 'VOTING', event: 'propose', actor: 'member' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'member' },
      { from: 'VOTING', to: 'ACTIVE', event: 'finalize', actor: 'admin' },
      { from: 'ACTIVE', to: 'DISPUTE', event: 'raise_dispute', actor: 'member' },
      { from: 'DISPUTE', to: 'DISPUTE', event: 'submit_evidence', actor: 'member' },
      { from: 'DISPUTE', to: 'DISPUTE', event: 'vote', actor: 'member' },
      { from: 'DISPUTE', to: 'ACTIVE', event: 'resolve', actor: 'admin' },
      { from: 'ACTIVE', to: 'DISSOLVED', event: 'dissolve', actor: 'creator' },
    ],
    generateStateData: (participants, ctx): GovernanceStateData => {
      const terms = randomTerms('governance');
      const admins = [participants.get('creator')!];
      if (participants.has('admin')) {
        admins.push(participants.get('admin')!);
      }
      
      const members: Record<string, { role: string; addedAt: number }> = {};
      const now = Date.now();
      
      // Add creator as admin
      members[participants.get('creator')!] = { role: 'admin', addedAt: now };
      
      // Add other admins
      for (const admin of admins.slice(1)) {
        members[admin] = { role: 'admin', addedAt: now };
      }
      
      // Add regular members
      for (const [role, addr] of participants.entries()) {
        if (role.startsWith('member') && !members[addr]) {
          members[addr] = { role: 'member', addedAt: now };
        }
      }
      
      return {
        schema: 'Governance',
        name: `${terms.name} #${ctx.fiberId.slice(0, 6)}`,
        creator: participants.get('creator')!,
        admins,
        members,
        rules: {
          maxMembers: 100,
          allowDisputes: true,
          requireVoteForRuleChanges: true,
        },
        votingPeriodMs: terms.votingPeriodDays * 24 * 60 * 60 * 1000,
        passingThreshold: terms.passingThreshold,
        disputeQuorum: terms.disputeQuorum,
        proposal: null,
        dispute: null,
        votes: {},
        history: [],
        status: 'ACTIVE',
        createdAt: now,
      };
    },
  },
};
