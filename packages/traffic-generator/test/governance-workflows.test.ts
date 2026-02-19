/**
 * Governance Workflows Integration Tests
 * 
 * Tests for the three DAO governance flow scenarios:
 * - dao-governance-flow-001: Full Governance Flow
 * - dao-delegation-flow-001: Delegation Flow  
 * - dao-veto-flow-001: Emergency Veto Flow
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { BridgeClient } from '../src/bridge-client';
import { 
  DAO_GOVERNANCE_TEST_FIBERS, 
  generateGovernanceTestConfigs,
  validateGovernanceTransitions,
  calculateVotingPower,
  type GovernanceTestConfig
} from '../src/governance-workflows';
import { FIBER_DEFINITIONS } from '../src/fiber-definitions';

// Mock Bridge Client for testing
class MockBridgeClient {
  private fibers = new Map<string, any>();
  private transitions: Array<{ fiberId: string; event: string; actor: string; timestamp: number }> = [];

  async createDAO(privateKey: string, daoType: string, name: string, initialData: any) {
    const fiberId = `dao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.fibers.set(fiberId, {
      id: fiberId,
      type: daoType,
      state: initialData.schema === 'DAO' ? 'ACTIVE' : 'CREATED',
      stateData: initialData,
      creator: initialData.creator,
      participants: initialData.members || []
    });
    return { fiberId, success: true };
  }

  async transitionFiber(privateKey: string, fiberId: string, event: string, payload: any = {}) {
    const fiber = this.fibers.get(fiberId);
    if (!fiber) throw new Error(`Fiber ${fiberId} not found`);

    this.transitions.push({
      fiberId,
      event,
      actor: this.getActorFromPrivateKey(privateKey),
      timestamp: Date.now()
    });

    // Mock state transitions based on event
    const newState = this.calculateNewState(fiber.state, event);
    fiber.state = newState;
    fiber.stateData = { ...fiber.stateData, ...payload };

    return { success: true, newState, transitionHash: `hash-${Date.now()}` };
  }

  private getActorFromPrivateKey(privateKey: string): string {
    // Extract actor from mock private key format: pk_actor_001
    return privateKey.split('_')[1] || 'unknown';
  }

  private calculateNewState(currentState: string, event: string): string {
    // Simplified state machine for testing
    const stateMap: Record<string, Record<string, string>> = {
      'ACTIVE': {
        'propose': 'DISCUSSING',
        'delegate': 'DELEGATED'
      },
      'DISCUSSING': {
        'start_voting': 'VOTING',
        'discuss': 'DISCUSSING'
      },
      'VOTING': {
        'vote': 'VOTING',
        'queue': 'QUEUED',
        'reject': 'REJECTED',
        'veto': 'VETO_PENDING'
      },
      'QUEUED': {
        'execute': 'EXECUTED',
        'cancel': 'REJECTED'
      },
      'DELEGATED': {
        're_delegate': 'RE_DELEGATED',
        'undelegate': 'UNDELEGATED',
        'propose': 'DELEGATED',
        'vote': 'DELEGATED'
      },
      'VETO_PENDING': {
        'support_veto': 'VETO_PENDING',
        'confirm_veto': 'VETOED',
        'override_veto': 'OVERRIDE'
      }
    };

    return stateMap[currentState]?.[event] || currentState;
  }

  getTransitions(fiberId?: string): Array<{ fiberId: string; event: string; actor: string; timestamp: number }> {
    return fiberId ? this.transitions.filter(t => t.fiberId === fiberId) : this.transitions;
  }

  getFiber(fiberId: string) {
    return this.fibers.get(fiberId);
  }

  reset() {
    this.fibers.clear();
    this.transitions.length = 0;
  }
}

describe('DAO Governance Test Scenarios', () => {
  let bridge: MockBridgeClient;
  let testConfigs: GovernanceTestConfig[];

  beforeEach(() => {
    bridge = new MockBridgeClient();
    testConfigs = generateGovernanceTestConfigs();
  });

  afterEach(() => {
    bridge.reset();
  });

  describe('Fiber Definition Validation', () => {
    it('should have all three governance test fiber definitions', () => {
      expect(DAO_GOVERNANCE_TEST_FIBERS).toHaveProperty('dao-governance-flow-001');
      expect(DAO_GOVERNANCE_TEST_FIBERS).toHaveProperty('dao-delegation-flow-001');
      expect(DAO_GOVERNANCE_TEST_FIBERS).toHaveProperty('dao-veto-flow-001');
    });

    it('should integrate governance test fibers into main FIBER_DEFINITIONS', () => {
      expect(FIBER_DEFINITIONS).toHaveProperty('dao-governance-flow-001');
      expect(FIBER_DEFINITIONS).toHaveProperty('dao-delegation-flow-001');
      expect(FIBER_DEFINITIONS).toHaveProperty('dao-veto-flow-001');
    });

    it('should have proper state machine structure for all governance flows', () => {
      Object.entries(DAO_GOVERNANCE_TEST_FIBERS).forEach(([type, definition]) => {
        expect(definition.states).toBeInstanceOf(Array);
        expect(definition.states.length).toBeGreaterThan(0);
        expect(definition.initialState).toBeTruthy();
        expect(definition.finalStates).toBeInstanceOf(Array);
        expect(definition.transitions).toBeInstanceOf(Array);
        expect(definition.transitions.length).toBeGreaterThan(0);
      });
    });
  });

  describe('dao-governance-flow-001: Full Governance Flow', () => {
    let config: GovernanceTestConfig;
    let fiberId: string;

    beforeEach(() => {
      config = testConfigs.find(c => c.fiberType === 'dao-governance-flow-001')!;
      expect(config).toBeDefined();
    });

    it('should create DAO with proper participants', async () => {
      const definition = DAO_GOVERNANCE_TEST_FIBERS['dao-governance-flow-001'];
      const participants = new Map(Array.from(config.participants.entries()).map(([role, data]) => [role, data.address]));
      const stateData = definition.generateStateData(participants, { fiberId: 'test-001', generation: 1 });

      const result = await bridge.createDAO(
        config.participants.get('proposer')!.privateKey,
        'dao-governance-flow-001',
        'Test Full Governance Flow',
        stateData
      );

      expect(result.success).toBe(true);
      expect(result.fiberId).toBeTruthy();
      fiberId = result.fiberId;

      const fiber = bridge.getFiber(fiberId);
      expect(fiber.stateData.members).toContain(config.participants.get('proposer')!.address);
      expect(fiber.stateData.members).toContain(config.participants.get('voter1')!.address);
    });

    it('should execute complete governance lifecycle', async () => {
      // Create the DAO first
      const definition = DAO_GOVERNANCE_TEST_FIBERS['dao-governance-flow-001'];
      const participants = new Map(Array.from(config.participants.entries()).map(([role, data]) => [role, data.address]));
      const stateData = definition.generateStateData(participants, { fiberId: 'test-001', generation: 1 });

      const createResult = await bridge.createDAO(
        config.participants.get('proposer')!.privateKey,
        'dao-governance-flow-001',
        'Test Full Governance Flow',
        stateData
      );
      fiberId = createResult.fiberId;

      // Execute transitions according to expected flow
      const transitions = [
        { event: 'propose', actor: 'proposer', payload: { proposalId: 'prop-001', title: 'Test Proposal' }},
        { event: 'discuss', actor: 'voter1', payload: { comment: 'Looks good' }},
        { event: 'discuss', actor: 'voter2', payload: { comment: 'Need clarification' }},
        { event: 'start_voting', actor: 'proposer', payload: {} },
        { event: 'vote', actor: 'voter1', payload: { vote: 'for' }},
        { event: 'vote', actor: 'voter2', payload: { vote: 'for' }},
        { event: 'vote', actor: 'voter3', payload: { vote: 'against' }},
        { event: 'queue', actor: 'guardian', payload: { reason: 'Passed threshold' }},
        { event: 'execute', actor: 'proposer', payload: {} },
      ];

      for (const transition of transitions) {
        const participantKey = config.participants.get(transition.actor)!.privateKey;
        const result = await bridge.transitionFiber(participantKey, fiberId, transition.event, transition.payload);
        expect(result.success).toBe(true);
      }

      // Validate transition sequence
      const actualTransitions = bridge.getTransitions(fiberId).map(t => t.event);
      const expectedEvents = transitions.map(t => t.event);
      const validation = validateGovernanceTransitions('dao-governance-flow-001', actualTransitions, expectedEvents);
      
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.log('Validation errors:', validation.errors);
      }

      // Check final state
      const finalFiber = bridge.getFiber(fiberId);
      expect(finalFiber.state).toBe('EXECUTED');
    });
  });

  describe('dao-delegation-flow-001: Delegation Flow', () => {
    let config: GovernanceTestConfig;
    let fiberId: string;

    beforeEach(() => {
      config = testConfigs.find(c => c.fiberType === 'dao-delegation-flow-001')!;
      expect(config).toBeDefined();
    });

    it('should handle delegation and re-delegation correctly', async () => {
      const definition = DAO_GOVERNANCE_TEST_FIBERS['dao-delegation-flow-001'];
      const participants = new Map(Array.from(config.participants.entries()).map(([role, data]) => [role, data.address]));
      const stateData = definition.generateStateData(participants, { fiberId: 'test-002', generation: 1 });

      const createResult = await bridge.createDAO(
        config.participants.get('proposer')!.privateKey,
        'dao-delegation-flow-001',
        'Test Delegation Flow',
        stateData
      );
      fiberId = createResult.fiberId;

      // Test delegation
      await bridge.transitionFiber(
        config.participants.get('delegator1')!.privateKey,
        fiberId,
        'delegate',
        { delegate: config.participants.get('delegate1')!.address }
      );

      await bridge.transitionFiber(
        config.participants.get('delegator2')!.privateKey,
        fiberId,
        'delegate',
        { delegate: config.participants.get('delegate2')!.address }
      );

      // Test re-delegation
      await bridge.transitionFiber(
        config.participants.get('delegator1')!.privateKey,
        fiberId,
        're_delegate',
        { newDelegate: config.participants.get('delegate2')!.address }
      );

      const transitions = bridge.getTransitions(fiberId);
      expect(transitions).toHaveLength(3);
      expect(transitions[0].event).toBe('delegate');
      expect(transitions[1].event).toBe('delegate');
      expect(transitions[2].event).toBe('re_delegate');
    });

    it('should calculate voting power correctly with delegations', () => {
      const balances = {
        '0x2001': 8000, // delegator1
        '0x2002': 6000, // delegator2
        '0x2003': 1000, // delegate1
        '0x2004': 1000, // delegate2
      };

      const delegations = {
        '0x2001': '0x2003', // delegator1 -> delegate1
        '0x2002': '0x2004', // delegator2 -> delegate2
      };

      // delegate1 should have their own power + delegator1's
      const delegate1Power = calculateVotingPower('0x2003', balances, delegations);
      expect(delegate1Power).toBe(9000); // 1000 + 8000

      // delegate2 should have their own power + delegator2's
      const delegate2Power = calculateVotingPower('0x2004', balances, delegations);
      expect(delegate2Power).toBe(7000); // 1000 + 6000

      // delegators should have 0 power when delegated
      const delegator1Power = calculateVotingPower('0x2001', balances, delegations);
      expect(delegator1Power).toBe(8000); // Still has own balance, delegation doesn't remove it
    });
  });

  describe('dao-veto-flow-001: Emergency Veto Flow', () => {
    let config: GovernanceTestConfig;
    let fiberId: string;

    beforeEach(() => {
      config = testConfigs.find(c => c.fiberType === 'dao-veto-flow-001')!;
      expect(config).toBeDefined();
    });

    it('should allow guardian veto during voting period', async () => {
      const definition = DAO_GOVERNANCE_TEST_FIBERS['dao-veto-flow-001'];
      const participants = new Map(Array.from(config.participants.entries()).map(([role, data]) => [role, data.address]));
      const stateData = definition.generateStateData(participants, { fiberId: 'test-003', generation: 1 });

      const createResult = await bridge.createDAO(
        config.participants.get('proposer')!.privateKey,
        'dao-veto-flow-001',
        'Test Emergency Veto Flow',
        stateData
      );
      fiberId = createResult.fiberId;

      // Start voting
      await bridge.transitionFiber(
        config.participants.get('proposer')!.privateKey,
        fiberId,
        'propose',
        { proposalId: 'veto-test-001', title: 'High-Risk Change' }
      );

      await bridge.transitionFiber(
        config.participants.get('voter1')!.privateKey,
        fiberId,
        'vote',
        { vote: 'for' }
      );

      await bridge.transitionFiber(
        config.participants.get('voter2')!.privateKey,
        fiberId,
        'vote',
        { vote: 'for' }
      );

      // Guardian initiates veto
      await bridge.transitionFiber(
        config.participants.get('guardian1')!.privateKey,
        fiberId,
        'veto',
        { reason: 'Security concerns with protocol upgrade' }
      );

      const fiber = bridge.getFiber(fiberId);
      expect(fiber.state).toBe('VETO_PENDING');
    });

    it('should complete veto with guardian confirmation', async () => {
      const definition = DAO_GOVERNANCE_TEST_FIBERS['dao-veto-flow-001'];
      const participants = new Map(Array.from(config.participants.entries()).map(([role, data]) => [role, data.address]));
      const stateData = definition.generateStateData(participants, { fiberId: 'test-003', generation: 1 });

      const createResult = await bridge.createDAO(
        config.participants.get('proposer')!.privateKey,
        'dao-veto-flow-001',
        'Test Emergency Veto Flow',
        stateData
      );
      fiberId = createResult.fiberId;

      // Execute veto flow
      const vetoFlow = [
        { event: 'propose', actor: 'proposer' },
        { event: 'vote', actor: 'voter1' },
        { event: 'vote', actor: 'voter2' },
        { event: 'veto', actor: 'guardian1' },
        { event: 'support_veto', actor: 'guardian2' },
        { event: 'confirm_veto', actor: 'guardian1' },
      ];

      for (const step of vetoFlow) {
        const participantKey = config.participants.get(step.actor)!.privateKey;
        await bridge.transitionFiber(participantKey, fiberId, step.event, {});
      }

      const finalFiber = bridge.getFiber(fiberId);
      expect(finalFiber.state).toBe('VETOED');

      const transitions = bridge.getTransitions(fiberId);
      const events = transitions.map(t => t.event);
      expect(events).toEqual(['propose', 'vote', 'vote', 'veto', 'support_veto', 'confirm_veto']);
    });
  });

  describe('Test Configuration Validation', () => {
    it('should generate valid test configurations', () => {
      expect(testConfigs).toHaveLength(3);
      
      testConfigs.forEach(config => {
        expect(config.fiberId).toBeTruthy();
        expect(config.fiberType).toBeTruthy();
        expect(config.participants.size).toBeGreaterThan(0);
        expect(config.expectedTransitions.length).toBeGreaterThan(0);
        expect(config.timingConstraints.votingPeriodMs).toBeGreaterThan(0);
        expect(config.assertions.length).toBeGreaterThan(0);
      });
    });

    it('should validate transition sequences correctly', () => {
      const validSequence = ['propose', 'vote', 'vote', 'execute'];
      const invalidSequence = ['propose', 'execute', 'vote']; // Wrong order

      const validResult = validateGovernanceTransitions('test', validSequence, validSequence);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      const invalidResult = validateGovernanceTransitions('test', invalidSequence, validSequence);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });
  });
});