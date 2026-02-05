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
  | 'Voting'
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
// Agent Identity Workflow
// ============================================================================

export const AGENT_IDENTITY_WORKFLOW: WorkflowDefinition = {
  type: 'AgentIdentity',
  name: 'AgentIdentity',
  description: 'Agent registration and reputation tracking',
  minParticipants: 1,
  maxParticipants: 1,
  states: ['Registered', 'Active', 'Challenged', 'Suspended', 'Withdrawn'],
  finalStates: ['Withdrawn'],
  transitions: [
    { from: 'Registered', to: 'Active', event: 'activate', actor: 'owner', weight: 1.0 },
    { from: 'Active', to: 'Active', event: 'receive_vouch', actor: 'third_party', weight: 0.6 },
    { from: 'Active', to: 'Active', event: 'receive_completion', actor: 'any', weight: 0.7 },
    { from: 'Active', to: 'Challenged', event: 'file_challenge', actor: 'third_party', weight: 0.05 },
    { from: 'Challenged', to: 'Active', event: 'dismiss_challenge', actor: 'any', weight: 0.7 },
    { from: 'Challenged', to: 'Suspended', event: 'uphold_challenge', actor: 'any', weight: 0.3 },
    { from: 'Active', to: 'Withdrawn', event: 'withdraw', actor: 'owner', weight: 0.02 },
  ],
  expectedDuration: 50,
  frequency: 3,
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
  states: ['Proposed', 'Active', 'Completed', 'Rejected', 'Disputed'],
  finalStates: ['Completed', 'Rejected'],
  transitions: [
    { from: 'Proposed', to: 'Active', event: 'accept', actor: 'counterparty', weight: 0.7 },
    { from: 'Proposed', to: 'Rejected', event: 'reject', actor: 'counterparty', weight: 0.3 },
    { from: 'Active', to: 'Completed', event: 'complete', actor: 'owner', weight: 0.85 },
    { from: 'Active', to: 'Disputed', event: 'dispute', actor: 'any', weight: 0.15 },
    { from: 'Disputed', to: 'Completed', event: 'resolve', actor: 'any', weight: 0.6 },
    { from: 'Disputed', to: 'Rejected', event: 'cancel', actor: 'any', weight: 0.4 },
  ],
  expectedDuration: 10,
  frequency: 5,
};

// ============================================================================
// Voting Workflow
// ============================================================================

export const VOTING_WORKFLOW: WorkflowDefinition = {
  type: 'Voting',
  name: 'Voting',
  description: 'Multi-party voting on candidates',
  minParticipants: 3,
  maxParticipants: 20,
  states: ['Pending', 'Voting', 'Completed'],
  finalStates: ['Completed'],
  transitions: [
    {
      from: 'Pending',
      to: 'Voting',
      event: 'startVoting',
      actor: 'owner',
      weight: 1.0,
      payloadFn: () => ({
        candidates: ['Alice', 'Bob', 'Charlie'],
        timestamp: Date.now(),
      }),
    },
    {
      from: 'Voting',
      to: 'Voting',
      event: 'castVote',
      actor: 'any',
      weight: 0.8,
      payloadFn: () => ({
        candidate: ['Alice', 'Bob', 'Charlie'][Math.floor(Math.random() * 3)],
        timestamp: Date.now(),
      }),
    },
    { from: 'Voting', to: 'Completed', event: 'endVoting', actor: 'owner', weight: 0.2 },
  ],
  expectedDuration: 8,
  frequency: 2,
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
  states: ['Pending', 'Funded', 'Released', 'Refunded'],
  finalStates: ['Released', 'Refunded'],
  transitions: [
    {
      from: 'Pending',
      to: 'Funded',
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
      from: 'Funded',
      to: 'Released',
      event: 'release',
      actor: 'owner',
      weight: 0.7,
      payloadFn: (ctx) => ({
        beneficiary: ctx.participants[1] || ctx.ownerAddress,
        timestamp: Date.now(),
      }),
    },
    { from: 'Funded', to: 'Refunded', event: 'refund', actor: 'owner', weight: 0.2 },
    { from: 'Funded', to: 'Refunded', event: 'expire', actor: 'any', weight: 0.1 },
  ],
  expectedDuration: 6,
  frequency: 3,
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
    { from: 'Playing', to: 'Finished', event: 'make_move', actor: 'any', weight: 0.1 },
    { from: 'Playing', to: 'Cancelled', event: 'cancel_game', actor: 'owner', weight: 0.05 },
  ],
  expectedDuration: 12,
  frequency: 2,
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
  states: ['Created', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'],
  finalStates: ['Delivered', 'Cancelled'],
  transitions: [
    { from: 'Created', to: 'Confirmed', event: 'confirm', actor: 'counterparty', weight: 0.8 },
    { from: 'Created', to: 'Cancelled', event: 'cancel', actor: 'owner', weight: 0.2 },
    { from: 'Confirmed', to: 'Shipped', event: 'ship', actor: 'counterparty', weight: 0.9 },
    { from: 'Confirmed', to: 'Cancelled', event: 'cancel', actor: 'any', weight: 0.1 },
    { from: 'Shipped', to: 'Delivered', event: 'deliver', actor: 'counterparty', weight: 0.95 },
    { from: 'Shipped', to: 'Cancelled', event: 'lost', actor: 'any', weight: 0.05 },
  ],
  expectedDuration: 8,
  frequency: 3,
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
  states: ['Draft', 'Submitted', 'Level1Approved', 'Level2Approved', 'Approved', 'Rejected'],
  finalStates: ['Approved', 'Rejected'],
  transitions: [
    { from: 'Draft', to: 'Submitted', event: 'submit', actor: 'owner', weight: 1.0 },
    { from: 'Submitted', to: 'Level1Approved', event: 'approve_l1', actor: 'counterparty', weight: 0.7 },
    { from: 'Submitted', to: 'Rejected', event: 'reject', actor: 'counterparty', weight: 0.3 },
    { from: 'Level1Approved', to: 'Level2Approved', event: 'approve_l2', actor: 'third_party', weight: 0.8 },
    { from: 'Level1Approved', to: 'Rejected', event: 'reject', actor: 'third_party', weight: 0.2 },
    { from: 'Level2Approved', to: 'Approved', event: 'finalize', actor: 'owner', weight: 0.9 },
    { from: 'Level2Approved', to: 'Rejected', event: 'cancel', actor: 'owner', weight: 0.1 },
  ],
  expectedDuration: 10,
  frequency: 2,
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
