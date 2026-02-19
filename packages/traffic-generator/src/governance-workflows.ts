/**
 * DAO Governance Flow Test Scenarios
 * 
 * Specific fiber test scenarios for comprehensive DAO testing:
 * 1. Full Governance Flow (dao-governance-flow-001)
 * 2. Delegation Flow (dao-delegation-flow-001) 
 * 3. Emergency Veto Flow (dao-veto-flow-001)
 */

import type { FiberDefinition, DAOStateData, FiberContext } from './fiber-definitions.js';

// ============================================================================
// Test Fiber Definitions
// ============================================================================

export const DAO_GOVERNANCE_TEST_FIBERS: Record<string, FiberDefinition> = {

  /**
   * dao-governance-flow-001: Full Governance Flow
   * Complete proposal lifecycle: create → discuss → vote → queue → execute
   */
  'dao-governance-flow-001': {
    type: 'dao-governance-flow-001',
    name: 'Full Governance Flow Test',
    workflowType: 'DAO',
    daoType: 'token',
    roles: ['proposer', 'voter1', 'voter2', 'voter3', 'guardian'],
    isVariableParty: true,
    states: ['ACTIVE', 'DISCUSSING', 'VOTING', 'QUEUED', 'EXECUTED', 'REJECTED'],
    initialState: 'ACTIVE',
    finalStates: ['EXECUTED', 'REJECTED'],
    transitions: [
      // Full governance lifecycle
      { from: 'ACTIVE', to: 'DISCUSSING', event: 'propose', actor: 'proposer' },
      { from: 'DISCUSSING', to: 'DISCUSSING', event: 'discuss', actor: 'voter1' },
      { from: 'DISCUSSING', to: 'DISCUSSING', event: 'discuss', actor: 'voter2' },
      { from: 'DISCUSSING', to: 'DISCUSSING', event: 'discuss', actor: 'voter3' },
      { from: 'DISCUSSING', to: 'VOTING', event: 'start_voting', actor: 'proposer' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter1' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter2' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter3' },
      { from: 'VOTING', to: 'QUEUED', event: 'queue', actor: 'guardian' },
      { from: 'VOTING', to: 'REJECTED', event: 'reject', actor: 'guardian' },
      { from: 'QUEUED', to: 'EXECUTED', event: 'execute', actor: 'proposer' },
      { from: 'QUEUED', to: 'REJECTED', event: 'cancel', actor: 'guardian' },
    ],
    generateStateData: (participants: Map<string, string>, ctx: FiberContext): DAOStateData => {
      const proposer = participants.get('proposer')!;
      const voters = ['voter1', 'voter2', 'voter3'].map(role => participants.get(role)!);
      const guardian = participants.get('guardian')!;
      const allMembers = [proposer, ...voters];
      
      // Generate voting power for each member
      const balances: Record<string, number> = {
        [proposer]: 10000, // Proposer has sufficient tokens to propose
        [voters[0]]: 5000,
        [voters[1]]: 3000,
        [voters[2]]: 2000,
      };
      
      return {
        schema: 'DAO',
        daoType: 'token',
        name: `Full Governance Flow Test #${ctx.fiberId.slice(0, 6)}`,
        creator: proposer,
        members: allMembers,
        balances,
        delegations: {},
        proposalThreshold: 1000,
        votingPeriodMs: 24 * 60 * 60 * 1000, // 24 hours
        timelockMs: 2 * 60 * 60 * 1000, // 2 hours
        quorum: 15000, // Requires majority of total supply (20k)
        proposal: {
          id: `proposal-${Date.now()}`,
          title: 'Treasury Fund Allocation',
          description: 'Allocate 100 OTTO tokens to development fund',
          actionType: 'treasury_transfer',
          payload: {
            recipient: proposer,
            amount: 100,
            token: 'OTTO'
          },
          proposer,
          proposedAt: Date.now(),
          deadline: Date.now() + (24 * 60 * 60 * 1000),
        },
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

  /**
   * dao-delegation-flow-001: Delegation Flow
   * Token delegation with re-delegation and undelegation
   */
  'dao-delegation-flow-001': {
    type: 'dao-delegation-flow-001',
    name: 'Delegation Flow Test',
    workflowType: 'DAO',
    daoType: 'token',
    roles: ['delegator1', 'delegator2', 'delegate1', 'delegate2', 'proposer'],
    isVariableParty: true,
    states: ['ACTIVE', 'DELEGATED', 'RE_DELEGATED', 'UNDELEGATED'],
    initialState: 'ACTIVE',
    finalStates: ['UNDELEGATED'],
    transitions: [
      // Delegation lifecycle
      { from: 'ACTIVE', to: 'DELEGATED', event: 'delegate', actor: 'delegator1' },
      { from: 'ACTIVE', to: 'DELEGATED', event: 'delegate', actor: 'delegator2' },
      { from: 'DELEGATED', to: 'RE_DELEGATED', event: 're_delegate', actor: 'delegator1' },
      { from: 'DELEGATED', to: 'RE_DELEGATED', event: 're_delegate', actor: 'delegator2' },
      { from: 'DELEGATED', to: 'UNDELEGATED', event: 'undelegate', actor: 'delegator1' },
      { from: 'DELEGATED', to: 'UNDELEGATED', event: 'undelegate', actor: 'delegator2' },
      { from: 'RE_DELEGATED', to: 'UNDELEGATED', event: 'undelegate', actor: 'delegator1' },
      { from: 'RE_DELEGATED', to: 'UNDELEGATED', event: 'undelegate', actor: 'delegator2' },
      // Test voting with delegated power
      { from: 'DELEGATED', to: 'DELEGATED', event: 'propose', actor: 'proposer' },
      { from: 'DELEGATED', to: 'DELEGATED', event: 'vote', actor: 'delegate1' },
      { from: 'DELEGATED', to: 'DELEGATED', event: 'vote', actor: 'delegate2' },
    ],
    generateStateData: (participants: Map<string, string>, ctx: FiberContext): DAOStateData => {
      const delegator1 = participants.get('delegator1')!;
      const delegator2 = participants.get('delegator2')!;
      const delegate1 = participants.get('delegate1')!;
      const delegate2 = participants.get('delegate2')!;
      const proposer = participants.get('proposer')!;
      const allMembers = [delegator1, delegator2, delegate1, delegate2, proposer];
      
      const balances: Record<string, number> = {
        [delegator1]: 8000, // High balance for delegation
        [delegator2]: 6000,
        [delegate1]: 1000, // Delegates have minimal tokens
        [delegate2]: 1000,
        [proposer]: 2000,
      };
      
      return {
        schema: 'DAO',
        daoType: 'token',
        name: `Delegation Flow Test #${ctx.fiberId.slice(0, 6)}`,
        creator: proposer,
        members: allMembers,
        balances,
        delegations: {}, // Will be populated during flow
        proposalThreshold: 1000,
        votingPeriodMs: 12 * 60 * 60 * 1000, // 12 hours
        timelockMs: 1 * 60 * 60 * 1000, // 1 hour
        quorum: 10000, // ~50% of total supply (18k)
        proposal: {
          id: `delegation-test-${Date.now()}`,
          title: 'Test Delegation Voting',
          description: 'Test proposal to verify delegation mechanics work correctly',
          actionType: 'parameter_change',
          payload: {
            parameter: 'votingPeriodMs',
            newValue: 18 * 60 * 60 * 1000, // 18 hours
          },
          proposer,
          proposedAt: Date.now(),
          deadline: Date.now() + (12 * 60 * 60 * 1000),
        },
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

  /**
   * dao-veto-flow-001: Emergency Veto Flow  
   * Guardian veto during voting period
   */
  'dao-veto-flow-001': {
    type: 'dao-veto-flow-001',
    name: 'Emergency Veto Flow Test',
    workflowType: 'DAO',
    daoType: 'token',
    roles: ['proposer', 'voter1', 'voter2', 'guardian1', 'guardian2'],
    isVariableParty: true,
    states: ['ACTIVE', 'VOTING', 'VETO_PENDING', 'VETOED', 'OVERRIDE', 'EXECUTED'],
    initialState: 'ACTIVE',
    finalStates: ['VETOED', 'EXECUTED'],
    transitions: [
      // Normal flow with veto intervention
      { from: 'ACTIVE', to: 'VOTING', event: 'propose', actor: 'proposer' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter1' },
      { from: 'VOTING', to: 'VOTING', event: 'vote', actor: 'voter2' },
      // Guardian veto during voting
      { from: 'VOTING', to: 'VETO_PENDING', event: 'veto', actor: 'guardian1' },
      { from: 'VETO_PENDING', to: 'VETO_PENDING', event: 'support_veto', actor: 'guardian2' },
      { from: 'VETO_PENDING', to: 'VETOED', event: 'confirm_veto', actor: 'guardian1' },
      // Override mechanism (super-majority can override veto)
      { from: 'VETO_PENDING', to: 'OVERRIDE', event: 'override_veto', actor: 'voter1' },
      { from: 'OVERRIDE', to: 'OVERRIDE', event: 'support_override', actor: 'voter2' },
      { from: 'OVERRIDE', to: 'EXECUTED', event: 'confirm_override', actor: 'proposer' },
      // Direct execution if no veto
      { from: 'VOTING', to: 'EXECUTED', event: 'execute', actor: 'proposer' },
    ],
    generateStateData: (participants: Map<string, string>, ctx: FiberContext): DAOStateData => {
      const proposer = participants.get('proposer')!;
      const voter1 = participants.get('voter1')!;
      const voter2 = participants.get('voter2')!;
      const guardian1 = participants.get('guardian1')!;
      const guardian2 = participants.get('guardian2')!;
      const allMembers = [proposer, voter1, voter2];
      
      const balances: Record<string, number> = {
        [proposer]: 12000, // High proposer balance
        [voter1]: 8000,   // Strong voting power
        [voter2]: 7000,   // Strong voting power
      };
      
      return {
        schema: 'DAO',
        daoType: 'token', 
        name: `Emergency Veto Flow Test #${ctx.fiberId.slice(0, 6)}`,
        creator: proposer,
        members: allMembers,
        balances,
        delegations: {},
        proposalThreshold: 1000,
        votingPeriodMs: 6 * 60 * 60 * 1000, // 6 hours (short for testing)
        timelockMs: 30 * 60 * 1000, // 30 minutes
        quorum: 15000, // Requires ~55% of supply (27k total)
        proposal: {
          id: `veto-test-${Date.now()}`,
          title: 'High-Risk Protocol Change',
          description: 'Emergency change to critical protocol parameters - subject to guardian veto',
          actionType: 'protocol_upgrade',
          payload: {
            target: 'governance_contract',
            newImplementation: '0x1234567890abcdef',
            riskLevel: 'HIGH',
          },
          proposer,
          proposedAt: Date.now(),
          deadline: Date.now() + (6 * 60 * 60 * 1000),
        },
        votes: {},
        executedProposals: [],
        status: 'ACTIVE',
        createdAt: Date.now(),
      };
    },
  },

};

// ============================================================================
// Multi-Signer Test Configuration
// ============================================================================

export interface GovernanceTestConfig {
  fiberId: string;
  fiberType: string;
  participants: Map<string, { address: string; privateKey: string }>;
  expectedTransitions: string[];
  timingConstraints: {
    discussionPeriodMs?: number;
    votingPeriodMs: number;
    timelockMs: number;
    vetoWindowMs?: number;
  };
  assertions: Array<{
    state: string;
    condition: string;
    expectedValue: unknown;
  }>;
}

/**
 * Generate test configurations for multi-signer coordination
 */
export function generateGovernanceTestConfigs(): GovernanceTestConfig[] {
  return [
    {
      fiberId: 'dao-governance-flow-001',
      fiberType: 'dao-governance-flow-001',
      participants: new Map([
        ['proposer', { address: '0x1001', privateKey: 'pk_proposer_001' }],
        ['voter1', { address: '0x1002', privateKey: 'pk_voter1_001' }],
        ['voter2', { address: '0x1003', privateKey: 'pk_voter2_001' }],
        ['voter3', { address: '0x1004', privateKey: 'pk_voter3_001' }],
        ['guardian', { address: '0x1005', privateKey: 'pk_guardian_001' }],
      ]),
      expectedTransitions: [
        'propose',
        'discuss', 'discuss', 'discuss',
        'start_voting',
        'vote', 'vote', 'vote',
        'queue',
        'execute'
      ],
      timingConstraints: {
        discussionPeriodMs: 2 * 60 * 60 * 1000, // 2 hours
        votingPeriodMs: 24 * 60 * 60 * 1000,   // 24 hours
        timelockMs: 2 * 60 * 60 * 1000,        // 2 hours
      },
      assertions: [
        { state: 'VOTING', condition: 'quorum_reached', expectedValue: true },
        { state: 'QUEUED', condition: 'timelock_active', expectedValue: true },
        { state: 'EXECUTED', condition: 'proposal_executed', expectedValue: true },
      ],
    },
    {
      fiberId: 'dao-delegation-flow-001',
      fiberType: 'dao-delegation-flow-001',
      participants: new Map([
        ['delegator1', { address: '0x2001', privateKey: 'pk_delegator1_001' }],
        ['delegator2', { address: '0x2002', privateKey: 'pk_delegator2_001' }],
        ['delegate1', { address: '0x2003', privateKey: 'pk_delegate1_001' }],
        ['delegate2', { address: '0x2004', privateKey: 'pk_delegate2_001' }],
        ['proposer', { address: '0x2005', privateKey: 'pk_proposer_001' }],
      ]),
      expectedTransitions: [
        'delegate', 'delegate',
        'propose', 
        'vote', 'vote',
        're_delegate',
        'vote',
        'undelegate', 'undelegate'
      ],
      timingConstraints: {
        votingPeriodMs: 12 * 60 * 60 * 1000, // 12 hours
        timelockMs: 1 * 60 * 60 * 1000,     // 1 hour
      },
      assertions: [
        { state: 'DELEGATED', condition: 'delegation_active', expectedValue: true },
        { state: 'RE_DELEGATED', condition: 'delegation_chain_valid', expectedValue: true },
        { state: 'UNDELEGATED', condition: 'voting_power_returned', expectedValue: true },
      ],
    },
    {
      fiberId: 'dao-veto-flow-001',
      fiberType: 'dao-veto-flow-001',
      participants: new Map([
        ['proposer', { address: '0x3001', privateKey: 'pk_proposer_001' }],
        ['voter1', { address: '0x3002', privateKey: 'pk_voter1_001' }],
        ['voter2', { address: '0x3003', privateKey: 'pk_voter2_001' }],
        ['guardian1', { address: '0x3004', privateKey: 'pk_guardian1_001' }],
        ['guardian2', { address: '0x3005', privateKey: 'pk_guardian2_001' }],
      ]),
      expectedTransitions: [
        'propose',
        'vote', 'vote',
        'veto',
        'support_veto',
        'confirm_veto'
      ],
      timingConstraints: {
        votingPeriodMs: 6 * 60 * 60 * 1000,  // 6 hours
        timelockMs: 30 * 60 * 1000,          // 30 minutes
        vetoWindowMs: 1 * 60 * 60 * 1000,    // 1 hour for veto decision
      },
      assertions: [
        { state: 'VOTING', condition: 'votes_cast', expectedValue: 2 },
        { state: 'VETO_PENDING', condition: 'veto_initiated', expectedValue: true },
        { state: 'VETOED', condition: 'proposal_blocked', expectedValue: true },
      ],
    },
  ];
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Validate governance test fiber transitions
 */
export function validateGovernanceTransitions(
  fiberType: string,
  actualTransitions: string[],
  expectedTransitions: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (actualTransitions.length !== expectedTransitions.length) {
    errors.push(`Transition count mismatch: expected ${expectedTransitions.length}, got ${actualTransitions.length}`);
  }
  
  for (let i = 0; i < Math.min(actualTransitions.length, expectedTransitions.length); i++) {
    if (actualTransitions[i] !== expectedTransitions[i]) {
      errors.push(`Transition ${i} mismatch: expected '${expectedTransitions[i]}', got '${actualTransitions[i]}'`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate voting power with delegation
 */
export function calculateVotingPower(
  address: string,
  balances: Record<string, number>,
  delegations: Record<string, string>
): number {
  let power = balances[address] || 0;
  
  // Add delegated power from others
  for (const [delegator, delegate] of Object.entries(delegations)) {
    if (delegate === address && delegator !== address) {
      power += balances[delegator] || 0;
    }
  }
  
  return power;
}

export default DAO_GOVERNANCE_TEST_FIBERS;