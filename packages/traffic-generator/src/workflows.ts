/**
 * Workflow Definitions
 * 
 * State machine definitions for different fiber types.
 * Based on OttoChain example tests in shared-data.
 */

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowType = 
  | 'AgentIdentity'
  | 'Contract'
  | 'VOTING'
  | 'TokenEscrow'
  | 'TicTacToe'
  | 'SimpleOrder'
  | 'ApprovalWorkflow';

export interface WorkflowDefinition {
  type: WorkflowType;
  name: string;
  description: string;
  minParticipants: number;
  maxParticipants: number;
  states: string[];
  finalStates: string[];
  transitions: WorkflowTransition[];
  /** Expected generations to completion */
  expectedDuration: number;
  /** Relative frequency weight */
  frequency: number;
  /** OttoChain state machine definition (JSON) */
  stateMachineDefinition: StateMachineDefinition;
  /** Initial data generator */
  initialDataFn: (ctx: CreateContext) => Record<string, unknown>;
}

export interface StateMachineDefinition {
  states: Record<string, { id: { value: string }; isFinal: boolean; metadata?: unknown }>;
  initialState: { value: string };
  transitions: Array<{
    from: { value: string };
    to: { value: string };
    eventName: string;
    guard: unknown;
    effect: unknown;
    dependencies?: string[];
  }>;
  metadata?: { name: string; description?: string };
  // Index signature for Record<string, unknown> compatibility
  [key: string]: unknown;
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
  /** Which participant role triggers this */
  actor: 'owner' | 'counterparty' | 'any' | 'third_party';
  /** Base probability weight */
  weight: number;
  /** Payload generator */
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
// Agent Identity Workflow (handled by /agent routes, included for completeness)
// ============================================================================

export const AGENT_IDENTITY_WORKFLOW: WorkflowDefinition = {
  type: 'AgentIdentity',
  name: 'AgentIdentity',
  description: 'Agent registration and reputation tracking',
  minParticipants: 1,
  maxParticipants: 1,
  states: ['REGISTERED', 'ACTIVE', 'CHALLENGED', 'SUSPENDED', 'WITHDRAWN'],
  finalStates: ['WITHDRAWN'],
  transitions: [
    { from: 'REGISTERED', to: 'ACTIVE', event: 'activate', actor: 'owner', weight: 1.0 },
    { from: 'ACTIVE', to: 'ACTIVE', event: 'receive_vouch', actor: 'third_party', weight: 0.6 },
    { from: 'ACTIVE', to: 'ACTIVE', event: 'receive_completion', actor: 'any', weight: 0.7 },
    { from: 'ACTIVE', to: 'CHALLENGED', event: 'file_challenge', actor: 'third_party', weight: 0.05 },
    { from: 'CHALLENGED', to: 'ACTIVE', event: 'dismiss_challenge', actor: 'any', weight: 0.7 },
    { from: 'CHALLENGED', to: 'SUSPENDED', event: 'uphold_challenge', actor: 'any', weight: 0.3 },
    { from: 'ACTIVE', to: 'WITHDRAWN', event: 'withdraw', actor: 'owner', weight: 0.02 },
  ],
  expectedDuration: 50,
  frequency: 3,
  stateMachineDefinition: {
    states: {
      Registered: { id: { value: 'REGISTERED' }, isFinal: false },
      Active: { id: { value: 'ACTIVE' }, isFinal: false },
      Withdrawn: { id: { value: 'WITHDRAWN' }, isFinal: true },
    },
    initialState: { value: 'REGISTERED' },
    transitions: [
      { from: { value: 'REGISTERED' }, to: { value: 'ACTIVE' }, eventName: 'activate', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'ACTIVE' }] } },
      { from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'receive_vouch', guard: { '!!': [{ var: 'event.from' }] }, effect: { merge: [{ var: 'state' }, { reputation: { '+': [{ var: 'state.reputation' }, 2] } }] } },
      { from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'receive_completion', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { reputation: { '+': [{ var: 'state.reputation' }, 5] } }] } },
      { from: { value: 'ACTIVE' }, to: { value: 'WITHDRAWN' }, eventName: 'withdraw', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'WITHDRAWN' }] } },
    ],
    metadata: { name: 'AgentIdentity', description: 'Agent registration and reputation' },
  },
  initialDataFn: (ctx) => ({
    owner: ctx.ownerAddress,
    reputation: 10,
    status: 'REGISTERED',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Contract Workflow
// ============================================================================

export const CONTRACT_WORKFLOW: WorkflowDefinition = {
  type: 'Contract',
  name: 'Contract',
  description: 'Two-party contract negotiation',
  minParticipants: 2,
  maxParticipants: 2,
  states: ['PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'DISPUTED'],
  finalStates: ['COMPLETED', 'REJECTED'],
  transitions: [
    { from: 'PROPOSED', to: 'ACTIVE', event: 'accept', actor: 'counterparty', weight: 0.7 },
    { from: 'PROPOSED', to: 'REJECTED', event: 'reject', actor: 'counterparty', weight: 0.3 },
    { from: 'ACTIVE', to: 'COMPLETED', event: 'complete', actor: 'owner', weight: 0.85 },
    { from: 'ACTIVE', to: 'DISPUTED', event: 'dispute', actor: 'any', weight: 0.15 },
    { from: 'DISPUTED', to: 'COMPLETED', event: 'resolve', actor: 'any', weight: 0.6 },
    { from: 'DISPUTED', to: 'REJECTED', event: 'cancel', actor: 'any', weight: 0.4 },
  ],
  expectedDuration: 10,
  frequency: 5,
  stateMachineDefinition: {
    states: {
      Proposed: { id: { value: 'PROPOSED' }, isFinal: false },
      Active: { id: { value: 'ACTIVE' }, isFinal: false },
      Completed: { id: { value: 'COMPLETED' }, isFinal: true },
      Rejected: { id: { value: 'REJECTED' }, isFinal: true },
      Disputed: { id: { value: 'DISPUTED' }, isFinal: false },
    },
    initialState: { value: 'PROPOSED' },
    transitions: [
      { from: { value: 'PROPOSED' }, to: { value: 'ACTIVE' }, eventName: 'accept', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'ACTIVE', acceptedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'PROPOSED' }, to: { value: 'REJECTED' }, eventName: 'reject', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'REJECTED', rejectedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'complete', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', completedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'ACTIVE' }, to: { value: 'DISPUTED' }, eventName: 'dispute', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'DISPUTED', disputedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'DISPUTED' }, to: { value: 'COMPLETED' }, eventName: 'resolve', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', resolvedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'DISPUTED' }, to: { value: 'REJECTED' }, eventName: 'cancel', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'REJECTED', cancelledAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'Contract', description: 'Two-party contract negotiation' },
  },
  initialDataFn: (ctx) => ({
    proposer: ctx.participants[0],
    counterparty: ctx.participants[1],
    status: 'PROPOSED',
    value: Math.floor(Math.random() * 1000) + 50,
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Voting Workflow
// ============================================================================

export const VOTING_WORKFLOW: WorkflowDefinition = {
  type: 'VOTING',
  name: 'VOTING',
  description: 'Multi-party voting on candidates',
  minParticipants: 3,
  maxParticipants: 20,
  states: ['PENDING', 'VOTING', 'COMPLETED'],
  finalStates: ['COMPLETED'],
  transitions: [
    {
      from: 'PENDING',
      to: 'VOTING',
      event: 'startVoting',
      actor: 'owner',
      weight: 1.0,
      payloadFn: () => ({
        candidates: ['Alice', 'Bob', 'Charlie'],
        timestamp: Date.now(),
      }),
    },
    {
      from: 'VOTING',
      to: 'VOTING',
      event: 'castVote',
      actor: 'any',
      weight: 0.8,
      payloadFn: () => ({
        candidate: ['Alice', 'Bob', 'Charlie'][Math.floor(Math.random() * 3)],
        timestamp: Date.now(),
      }),
    },
    { from: 'VOTING', to: 'COMPLETED', event: 'endVoting', actor: 'owner', weight: 0.2 },
  ],
  expectedDuration: 8,
  frequency: 2,
  stateMachineDefinition: {
    states: {
      Pending: { id: { value: 'PENDING' }, isFinal: false },
      Voting: { id: { value: 'VOTING' }, isFinal: false },
      Completed: { id: { value: 'COMPLETED' }, isFinal: true },
    },
    initialState: { value: 'PENDING' },
    transitions: [
      { from: { value: 'PENDING' }, to: { value: 'VOTING' }, eventName: 'startVoting', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { candidates: { var: 'event.candidates' }, votingStartedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'VOTING' }, to: { value: 'VOTING' }, eventName: 'castVote', guard: { '!!': [{ var: 'event.candidate' }] }, effect: { merge: [{ var: 'state' }, { lastVoteAt: { var: 'event.timestamp' }, voteCount: { '+': [{ var: 'state.voteCount' }, 1] } }] } },
      { from: { value: 'VOTING' }, to: { value: 'COMPLETED' }, eventName: 'endVoting', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', endedAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'VOTING', description: 'Multi-party voting' },
  },
  initialDataFn: (ctx) => ({
    owner: ctx.ownerAddress,
    candidates: [],
    voteCount: 0,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Token Escrow Workflow
// ============================================================================

export const TOKEN_ESCROW_WORKFLOW: WorkflowDefinition = {
  type: 'TokenEscrow',
  name: 'TokenEscrow',
  description: 'Escrow with fund/release/refund',
  minParticipants: 2,
  maxParticipants: 3,
  states: ['PENDING', 'FUNDED', 'RELEASED', 'REFUNDED'],
  finalStates: ['RELEASED', 'REFUNDED'],
  transitions: [
    {
      from: 'PENDING',
      to: 'FUNDED',
      event: 'fund',
      actor: 'owner',
      weight: 1.0,
      payloadFn: (ctx) => ({
        depositor: ctx.ownerAddress,
        amount: Math.floor(Math.random() * 1000) + 100,
        timestamp: Date.now(),
      }),
    },
    {
      from: 'FUNDED',
      to: 'RELEASED',
      event: 'release',
      actor: 'owner',
      weight: 0.7,
      payloadFn: (ctx) => ({
        beneficiary: ctx.participants[1] || ctx.ownerAddress,
        timestamp: Date.now(),
      }),
    },
    { from: 'FUNDED', to: 'REFUNDED', event: 'refund', actor: 'owner', weight: 0.2 },
    { from: 'FUNDED', to: 'REFUNDED', event: 'expire', actor: 'any', weight: 0.1 },
  ],
  expectedDuration: 6,
  frequency: 3,
  stateMachineDefinition: {
    states: {
      Pending: { id: { value: 'PENDING' }, isFinal: false },
      Funded: { id: { value: 'FUNDED' }, isFinal: false },
      Released: { id: { value: 'RELEASED' }, isFinal: true },
      Refunded: { id: { value: 'REFUNDED' }, isFinal: true },
    },
    initialState: { value: 'PENDING' },
    transitions: [
      { from: { value: 'PENDING' }, to: { value: 'FUNDED' }, eventName: 'fund', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { depositor: { var: 'event.depositor' }, amount: { var: 'event.amount' }, fundedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'FUNDED' }, to: { value: 'RELEASED' }, eventName: 'release', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { beneficiary: { var: 'event.beneficiary' }, releasedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'FUNDED' }, to: { value: 'REFUNDED' }, eventName: 'refund', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { refundedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'FUNDED' }, to: { value: 'REFUNDED' }, eventName: 'expire', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { expiredAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'TokenEscrow', description: 'Escrow with fund/release/refund' },
  },
  initialDataFn: (ctx) => ({
    depositor: '',
    beneficiary: ctx.participants[1] || '',
    amount: 0,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// TicTacToe Workflow
// ============================================================================

export const TICTACTOE_WORKFLOW: WorkflowDefinition = {
  type: 'TicTacToe',
  name: 'TicTacToe',
  description: 'Two-player game',
  minParticipants: 2,
  maxParticipants: 2,
  states: ['Setup', 'Playing', 'Finished', 'Cancelled'],
  finalStates: ['Finished', 'Cancelled'],
  transitions: [
    {
      from: 'Setup',
      to: 'Playing',
      event: 'start_game',
      actor: 'owner',
      weight: 1.0,
      payloadFn: (ctx) => ({
        playerX: ctx.participants[0],
        playerO: ctx.participants[1],
        gameId: ctx.fiberId,
        timestamp: Date.now(),
      }),
    },
    {
      from: 'Playing',
      to: 'Playing',
      event: 'make_move',
      actor: 'any',
      weight: 0.85,
      payloadFn: (ctx) => ({
        player: ctx.participants[Math.floor(Math.random() * 2)],
        cell: Math.floor(Math.random() * 9),
        timestamp: Date.now(),
      }),
    },
    { from: 'Playing', to: 'Finished', event: 'finish_game', actor: 'any', weight: 0.1 },
    { from: 'Playing', to: 'Cancelled', event: 'cancel_game', actor: 'owner', weight: 0.05 },
  ],
  expectedDuration: 12,
  frequency: 2,
  stateMachineDefinition: {
    states: {
      Setup: { id: { value: 'Setup' }, isFinal: false },
      Playing: { id: { value: 'Playing' }, isFinal: false },
      Finished: { id: { value: 'Finished' }, isFinal: true },
      Cancelled: { id: { value: 'Cancelled' }, isFinal: true },
    },
    initialState: { value: 'Setup' },
    transitions: [
      { from: { value: 'Setup' }, to: { value: 'Playing' }, eventName: 'start_game', guard: { and: [{ '!!': [{ var: 'event.playerX' }] }, { '!!': [{ var: 'event.playerO' }] }] }, effect: { merge: [{ var: 'state' }, { playerX: { var: 'event.playerX' }, playerO: { var: 'event.playerO' }, gameId: { var: 'event.gameId' }, moveCount: 0, status: 'Playing' }] } },
      { from: { value: 'Playing' }, to: { value: 'Playing' }, eventName: 'make_move', guard: { '<': [{ var: 'state.moveCount' }, 9] }, effect: { merge: [{ var: 'state' }, { lastMove: { player: { var: 'event.player' }, cell: { var: 'event.cell' } }, moveCount: { '+': [{ var: 'state.moveCount' }, 1] } }] } },
      { from: { value: 'Playing' }, to: { value: 'Finished' }, eventName: 'finish_game', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Finished', finishedAt: { var: 'event.timestamp' }, winner: { var: 'event.winner' } }] } },
      { from: { value: 'Playing' }, to: { value: 'Cancelled' }, eventName: 'cancel_game', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Cancelled', cancelledAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'TicTacToe', description: 'Two-player tic-tac-toe game' },
  },
  initialDataFn: (ctx) => ({
    playerX: ctx.participants[0],
    playerO: ctx.participants[1],
    gameId: ctx.fiberId,
    board: [null, null, null, null, null, null, null, null, null],
    moveCount: 0,
    status: 'Setup',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Simple Order Workflow
// ============================================================================

export const SIMPLE_ORDER_WORKFLOW: WorkflowDefinition = {
  type: 'SimpleOrder',
  name: 'SimpleOrder',
  description: 'Order fulfillment workflow',
  minParticipants: 2,
  maxParticipants: 2,
  states: ['Created', 'Confirmed', 'Shipped', 'DELIVERED', 'Cancelled'],
  finalStates: ['DELIVERED', 'Cancelled'],
  transitions: [
    { from: 'Created', to: 'Confirmed', event: 'confirm', actor: 'counterparty', weight: 0.8 },
    { from: 'Created', to: 'Cancelled', event: 'cancel', actor: 'owner', weight: 0.2 },
    { from: 'Confirmed', to: 'Shipped', event: 'ship', actor: 'counterparty', weight: 0.9 },
    { from: 'Confirmed', to: 'Cancelled', event: 'cancel', actor: 'any', weight: 0.1 },
    { from: 'Shipped', to: 'DELIVERED', event: 'deliver', actor: 'counterparty', weight: 0.95 },
    { from: 'Shipped', to: 'Cancelled', event: 'lost', actor: 'any', weight: 0.05 },
  ],
  expectedDuration: 8,
  frequency: 3,
  stateMachineDefinition: {
    states: {
      Created: { id: { value: 'Created' }, isFinal: false },
      Confirmed: { id: { value: 'Confirmed' }, isFinal: false },
      Shipped: { id: { value: 'Shipped' }, isFinal: false },
      Delivered: { id: { value: 'DELIVERED' }, isFinal: true },
      Cancelled: { id: { value: 'Cancelled' }, isFinal: true },
    },
    initialState: { value: 'Created' },
    transitions: [
      { from: { value: 'Created' }, to: { value: 'Confirmed' }, eventName: 'confirm', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Confirmed', confirmedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Created' }, to: { value: 'Cancelled' }, eventName: 'cancel', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Cancelled', cancelledAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Confirmed' }, to: { value: 'Shipped' }, eventName: 'ship', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Shipped', shippedAt: { var: 'event.timestamp' }, trackingNumber: { var: 'event.trackingNumber' } }] } },
      { from: { value: 'Confirmed' }, to: { value: 'Cancelled' }, eventName: 'cancel', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Cancelled', cancelledAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Shipped' }, to: { value: 'DELIVERED' }, eventName: 'deliver', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'DELIVERED', deliveredAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Shipped' }, to: { value: 'Cancelled' }, eventName: 'lost', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Cancelled', lostAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'SimpleOrder', description: 'Order fulfillment workflow' },
  },
  initialDataFn: (ctx) => ({
    buyer: ctx.ownerAddress,
    seller: ctx.participants[1] || '',
    items: [{ name: `Item_${Date.now().toString(36)}`, quantity: Math.floor(Math.random() * 5) + 1 }],
    total: Math.floor(Math.random() * 500) + 20,
    status: 'Created',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// Approval Workflow
// ============================================================================

export const APPROVAL_WORKFLOW: WorkflowDefinition = {
  type: 'ApprovalWorkflow',
  name: 'ApprovalWorkflow',
  description: 'Multi-level approval process',
  minParticipants: 3,
  maxParticipants: 5,
  states: ['Draft', 'Submitted', 'Level1Approved', 'Level2Approved', 'APPROVED', 'REJECTED'],
  finalStates: ['APPROVED', 'REJECTED'],
  transitions: [
    { from: 'Draft', to: 'Submitted', event: 'submit', actor: 'owner', weight: 1.0 },
    { from: 'Submitted', to: 'Level1Approved', event: 'approve_l1', actor: 'counterparty', weight: 0.7 },
    { from: 'Submitted', to: 'REJECTED', event: 'reject', actor: 'counterparty', weight: 0.3 },
    { from: 'Level1Approved', to: 'Level2Approved', event: 'approve_l2', actor: 'third_party', weight: 0.8 },
    { from: 'Level1Approved', to: 'REJECTED', event: 'reject', actor: 'third_party', weight: 0.2 },
    { from: 'Level2Approved', to: 'APPROVED', event: 'finalize', actor: 'owner', weight: 0.9 },
    { from: 'Level2Approved', to: 'REJECTED', event: 'cancel', actor: 'owner', weight: 0.1 },
  ],
  expectedDuration: 10,
  frequency: 2,
  stateMachineDefinition: {
    states: {
      Draft: { id: { value: 'Draft' }, isFinal: false },
      Submitted: { id: { value: 'Submitted' }, isFinal: false },
      Level1Approved: { id: { value: 'Level1Approved' }, isFinal: false },
      Level2Approved: { id: { value: 'Level2Approved' }, isFinal: false },
      Approved: { id: { value: 'APPROVED' }, isFinal: true },
      Rejected: { id: { value: 'REJECTED' }, isFinal: true },
    },
    initialState: { value: 'Draft' },
    transitions: [
      { from: { value: 'Draft' }, to: { value: 'Submitted' }, eventName: 'submit', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Submitted', submittedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Submitted' }, to: { value: 'Level1Approved' }, eventName: 'approve_l1', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Level1Approved', l1ApprovedAt: { var: 'event.timestamp' }, l1Approver: { var: 'event.approver' } }] } },
      { from: { value: 'Submitted' }, to: { value: 'REJECTED' }, eventName: 'reject', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'REJECTED', rejectedAt: { var: 'event.timestamp' }, rejectedBy: { var: 'event.rejector' }, rejectReason: { var: 'event.reason' } }] } },
      { from: { value: 'Level1Approved' }, to: { value: 'Level2Approved' }, eventName: 'approve_l2', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'Level2Approved', l2ApprovedAt: { var: 'event.timestamp' }, l2Approver: { var: 'event.approver' } }] } },
      { from: { value: 'Level1Approved' }, to: { value: 'REJECTED' }, eventName: 'reject', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'REJECTED', rejectedAt: { var: 'event.timestamp' }, rejectedBy: { var: 'event.rejector' }, rejectReason: { var: 'event.reason' } }] } },
      { from: { value: 'Level2Approved' }, to: { value: 'APPROVED' }, eventName: 'finalize', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'APPROVED', finalizedAt: { var: 'event.timestamp' } }] } },
      { from: { value: 'Level2Approved' }, to: { value: 'REJECTED' }, eventName: 'cancel', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'REJECTED', cancelledAt: { var: 'event.timestamp' } }] } },
    ],
    metadata: { name: 'ApprovalWorkflow', description: 'Multi-level approval process' },
  },
  initialDataFn: (ctx) => ({
    requester: ctx.ownerAddress,
    l1Approver: ctx.participants[1] || '',
    l2Approver: ctx.participants[2] || '',
    title: `Request_${Date.now().toString(36)}`,
    description: 'Simulated approval request',
    amount: Math.floor(Math.random() * 10000) + 100,
    status: 'Draft',
    createdAt: new Date().toISOString(),
  }),
};

// ============================================================================
// All Workflows
// ============================================================================

export const ALL_WORKFLOWS: WorkflowDefinition[] = [
  AGENT_IDENTITY_WORKFLOW,
  CONTRACT_WORKFLOW,
  VOTING_WORKFLOW,
  TOKEN_ESCROW_WORKFLOW,
  TICTACTOE_WORKFLOW,
  SIMPLE_ORDER_WORKFLOW,
  APPROVAL_WORKFLOW,
];

/**
 * Get available transitions for a workflow in a given state
 */
export function getAvailableTransitions(
  workflow: WorkflowDefinition,
  currentState: string
): WorkflowTransition[] {
  return workflow.transitions.filter((t) => t.from === currentState);
}

/**
 * Check if a workflow is in a final state
 */
export function isWorkflowComplete(
  workflow: WorkflowDefinition,
  currentState: string
): boolean {
  return workflow.finalStates.includes(currentState);
}

/**
 * Select a workflow type based on frequency weights
 */
export function selectWorkflowType(workflows: WorkflowDefinition[]): WorkflowDefinition {
  const totalWeight = workflows.reduce((sum, w) => sum + w.frequency, 0);
  let random = Math.random() * totalWeight;
  
  for (const workflow of workflows) {
    random -= workflow.frequency;
    if (random <= 0) return workflow;
  }
  
  return workflows[0];
}
