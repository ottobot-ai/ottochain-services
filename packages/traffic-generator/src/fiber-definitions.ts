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
  workflowType: 'Contract' | 'AgentIdentity' | 'Custom' | 'Market';
  roles: string[];  // e.g., ['proposer', 'counterparty'] or ['playerX', 'playerO']
  isVariableParty: boolean;  // true for voting, multi-sig
  /** Contract states from SDK: PROPOSED → ACTIVE → COMPLETED/REJECTED/DISPUTED */
  states: string[];
  initialState: string;
  finalStates: string[];
  transitions: TransitionDef[];
  /** Market type for Market workflows */
  marketType?: 'prediction' | 'auction' | 'crowdfund' | 'group_buy';
  /** Generate initial stateData for this fiber type */
  generateStateData: (participants: Map<string, string>, context: FiberContext) => ContractStateData | CustomStateData | MarketStateData;
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
};
