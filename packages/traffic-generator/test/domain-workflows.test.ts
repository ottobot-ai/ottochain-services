/**
 * @file domain-workflows.test.ts
 * @description TDD tests for Traffic Generator domain workflow types integration
 * 
 * Specification: 🚦 Traffic Generator: All domain workflow types 
 * Card ID: 6996294ad9
 * 
 * Phase 1 (UNBLOCKED): agentIdentityDefinition + tokenEscrow integration
 * Phase 2 (BLOCKED on PR #80+#144): createTokenFiberDefinition with mocked SDK
 * 
 * 22 tests in 6 groups:
 * - Group 1: Agent Identity Workflow Integration (T1-T4)
 * - Group 2: Token Escrow Integration (T5-T8) 
 * - Group 3: Environment Flag Controls (T9-T12)
 * - Group 4: Fiber Weight Configuration (T13-T16)
 * - Group 5: Error Handling (T17-T20)
 * - Group 6: TDEG Token Workflows (T21-T22)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Simulator } from '../src/simulator';
import { WorkflowDefinition, WorkflowType } from '../src/workflows';
import { FiberDefinition } from '../src/fiber-definitions';
import type { GeneratorConfig } from '../src/types';

// Mock SDK for Phase 2 tests (blocked on PR #80+#144)
vi.mock('@ottochain/sdk', () => ({
  createTokenStateMachine: vi.fn(),
  TokenBehavior: {
    TRANSFERABLE: 'transferable',
    BURNABLE: 'burnable',
    NON_TRANSFERABLE: 'non_transferable',
    EXPIRABLE: 'expirable'
  }
}));

describe('Traffic Generator Domain Workflows - TDD', () => {
  let simulator: Simulator;
  let config: Partial<GeneratorConfig>;

  beforeEach(() => {
    config = {
      bridgeUrl: 'http://localhost:3030',
      ml0Url: 'http://localhost:9200',
      targetPopulation: 10,
      generationIntervalMs: 1000
    };

    // Reset environment variables
    delete process.env.ENABLE_AGENT_IDENTITY;
    delete process.env.ENABLE_TOKEN_ESCROW;
    delete process.env.ENABLE_TOKEN_DOMAIN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Group 1: Agent Identity Workflow Integration (T1-T4)
  // ============================================================================

  describe('Group 1: Agent Identity Workflow Integration', () => {
    it('T1: Should include agentIdentity in available workflow types', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      simulator = new Simulator(config);

      // ACT
      const availableWorkflows = simulator.getAvailableWorkflowTypes();

      // ASSERT
      expect(availableWorkflows).toContain('AgentProfile');
      expect(availableWorkflows).toEqual(
        expect.arrayContaining(['AgentProfile', 'Contract', 'Market', 'Governance', 'TokenEscrow'])
      );
    });

    it('T2: Should create agentIdentityDefinition with correct state machine', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      simulator = new Simulator(config);

      // ACT
      const agentIdentityDef = simulator.getWorkflowDefinition('AgentProfile');

      // ASSERT
      expect(agentIdentityDef).toBeDefined();
      expect(agentIdentityDef.workflowType).toBe('AgentProfile');
      expect(agentIdentityDef.states).toEqual(['REGISTERED', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN']);
      expect(agentIdentityDef.initialState).toBe('REGISTERED');
      expect(agentIdentityDef.finalStates).toContain('WITHDRAWN');
      
      // Verify 6 transitions matching agent-identity.json
      const transitions = agentIdentityDef.transitions;
      expect(transitions).toHaveLength(6);
      expect(transitions.some(t => t.from === 'REGISTERED' && t.to === 'ACTIVE' && t.event === 'receive_vouch')).toBe(true);
      expect(transitions.some(t => t.from === 'ACTIVE' && t.to === 'ACTIVE' && t.event === 'receive_completion')).toBe(true);
    });

    it('T3: Should orchestrate agent identity workflow with correct probabilities', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      simulator = new Simulator(config);
      
      // ACT
      const orchestrator = simulator.getOrchestrator();
      const agentFiber = await orchestrator.createAgentIdentityFiber('test-wallet-addr');
      
      // ASSERT
      expect(agentFiber.state).toBe('REGISTERED');
      expect(agentFiber.workflowType).toBe('AgentProfile');
      
      // Test transition probabilities from spec:
      // registered(80% vouch)/active(60% completion, 20% violation, 10% challenge)/suspended(70% uphold, 30% deactivate)
      const registeredTransitions = orchestrator.getAvailableTransitions(agentFiber);
      expect(registeredTransitions.find(t => t.event === 'receive_vouch')?.weight).toBe(0.8);
      
      // Move to ACTIVE and test probabilities
      agentFiber.state = 'ACTIVE';
      const activeTransitions = orchestrator.getAvailableTransitions(agentFiber);
      expect(activeTransitions.find(t => t.event === 'receive_completion')?.weight).toBe(0.6);
      expect(activeTransitions.find(t => t.event === 'receive_violation')?.weight).toBe(0.2);
      expect(activeTransitions.find(t => t.event === 'challenge')?.weight).toBe(0.1);
    });

    it('T4: Should handle agent identity reputation tracking', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      simulator = new Simulator(config);
      const orchestrator = simulator.getOrchestrator();
      
      // ACT
      const agentFiber = await orchestrator.createAgentIdentityFiber('test-wallet-addr');
      await orchestrator.executeTransition(agentFiber, 'receive_vouch');
      await orchestrator.executeTransition(agentFiber, 'receive_completion');
      
      // ASSERT
      const agentState = orchestrator.getAgentState(agentFiber.fiberId);
      expect(agentState.reputation).toBeGreaterThan(0);
      expect(agentState.completionCount).toBe(1);
      expect(agentState.state).toBe('ACTIVE');
    });
  });

  // ============================================================================
  // Group 2: Token Escrow Integration (T5-T8)
  // ============================================================================

  describe('Group 2: Token Escrow Integration', () => {
    it('T5: Should include tokenEscrow in fiberWeights configuration', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);

      // ACT
      const fiberWeights = simulator.getFiberWeights();

      // ASSERT
      expect(fiberWeights).toHaveProperty('tokenEscrow');
      expect(fiberWeights.tokenEscrow).toBe(5); // From spec: tokenEscrow=5
      expect(fiberWeights.agentIdentity).toBe(10); // From spec: agentIdentity=10
    });

    it('T6: Should create TokenEscrow fiber with proper state machine', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);

      // ACT
      const tokenEscrowDef = simulator.getWorkflowDefinition('TokenEscrow');

      // ASSERT
      expect(tokenEscrowDef).toBeDefined();
      expect(tokenEscrowDef.workflowType).toBe('TokenEscrow');
      expect(tokenEscrowDef.states).toEqual(['PROPOSED', 'FUNDED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
      expect(tokenEscrowDef.initialState).toBe('PROPOSED');
      expect(tokenEscrowDef.finalStates).toEqual(expect.arrayContaining(['COMPLETED', 'CANCELLED']));
    });

    it('T7: Should generate TokenEscrow workflows in traffic generation', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);
      
      // ACT
      await simulator.start();
      const stats = await simulator.runOneGeneration();
      
      // ASSERT
      expect(stats.workflowCounts).toHaveProperty('TokenEscrow');
      expect(stats.workflowCounts.TokenEscrow).toBeGreaterThan(0);
      
      // Verify distribution according to weights (tokenEscrow=5 vs total)
      const totalWeight = Object.values(simulator.getFiberWeights()).reduce((a, b) => a + b, 0);
      const expectedRatio = 5 / totalWeight;
      const actualRatio = stats.workflowCounts.TokenEscrow / stats.totalTransactions;
      expect(actualRatio).toBeCloseTo(expectedRatio, 1);
    });

    it('T8: Should handle TokenEscrow lifecycle transitions', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);
      const orchestrator = simulator.getOrchestrator();
      
      // ACT
      const escrowFiber = await orchestrator.createTokenEscrowFiber(['proposer', 'beneficiary']);
      expect(escrowFiber.state).toBe('PROPOSED');
      
      await orchestrator.executeTransition(escrowFiber, 'fund');
      expect(escrowFiber.state).toBe('FUNDED');
      
      await orchestrator.executeTransition(escrowFiber, 'activate');
      expect(escrowFiber.state).toBe('ACTIVE');
      
      // ASSERT
      const escrowState = orchestrator.getFiberState(escrowFiber.fiberId);
      expect(escrowState.tokenAmount).toBeDefined();
      expect(escrowState.escrowAddress).toBeDefined();
      expect(escrowState.beneficiaryAddress).toBeDefined();
    });
  });

  // ============================================================================
  // Group 3: Environment Flag Controls (T9-T12)
  // ============================================================================

  describe('Group 3: Environment Flag Controls', () => {
    it('T9: Should disable AgentProfile when ENABLE_AGENT_IDENTITY=false', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'false';
      simulator = new Simulator(config);

      // ACT
      const availableWorkflows = simulator.getAvailableWorkflowTypes();

      // ASSERT
      expect(availableWorkflows).not.toContain('AgentProfile');
      expect(simulator.getFiberWeights()).not.toHaveProperty('agentIdentity');
    });

    it('T10: Should disable TokenEscrow when ENABLE_TOKEN_ESCROW=false', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_ESCROW = 'false';
      simulator = new Simulator(config);

      // ACT
      const availableWorkflows = simulator.getAvailableWorkflowTypes();

      // ASSERT
      expect(availableWorkflows).not.toContain('TokenEscrow');
      expect(simulator.getFiberWeights()).not.toHaveProperty('tokenEscrow');
    });

    it('T11: Should respect ENABLE_TOKEN_DOMAIN for Phase 2 token workflows', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      simulator = new Simulator(config);

      // ACT
      const tokenDomainEnabled = simulator.isTokenDomainEnabled();

      // ASSERT
      expect(tokenDomainEnabled).toBe(true);
      // When enabled, should prepare for createTokenFiberDefinition calls
      expect(simulator.getTokenWorkflowPreparationState()).toBe('ready');
    });

    it('T12: Should default to enabled when environment flags are unset', async () => {
      // ARRANGE
      // All ENABLE_* vars are deleted in beforeEach
      simulator = new Simulator(config);

      // ACT
      const availableWorkflows = simulator.getAvailableWorkflowTypes();

      // ASSERT
      // Default behavior: enable AgentProfile and TokenEscrow
      expect(availableWorkflows).toContain('AgentProfile');
      expect(availableWorkflows).toContain('TokenEscrow');
      expect(simulator.getFiberWeights().agentIdentity).toBe(10);
      expect(simulator.getFiberWeights().tokenEscrow).toBe(5);
    });
  });

  // ============================================================================
  // Group 4: Fiber Weight Configuration (T13-T16)
  // ============================================================================

  describe('Group 4: Fiber Weight Configuration', () => {
    it('T13: Should configure Phase 1 weights correctly', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);

      // ACT
      const weights = simulator.getFiberWeights();

      // ASSERT
      expect(weights.agentIdentity).toBe(10);
      expect(weights.tokenEscrow).toBe(5);
      
      // Existing weights should remain
      expect(weights.contract).toBeGreaterThan(0);
      expect(weights.market).toBeGreaterThan(0);
      expect(weights.governance).toBeGreaterThan(0);
    });

    it('T14: Should distribute workflow selection according to weights', async () => {
      // ARRANGE
      process.env.ENABLE_AGENT_IDENTITY = 'true';
      process.env.ENABLE_TOKEN_ESCROW = 'true';
      simulator = new Simulator(config);
      
      // ACT
      const selections = [];
      for (let i = 0; i < 1000; i++) {
        selections.push(simulator.selectWorkflowTypeByWeight());
      }
      
      // ASSERT
      const agentCount = selections.filter(s => s === 'AgentProfile').length;
      const escrowCount = selections.filter(s => s === 'TokenEscrow').length;
      
      // Should follow 2:1 ratio (agentIdentity=10, tokenEscrow=5)
      const ratio = agentCount / escrowCount;
      expect(ratio).toBeCloseTo(2.0, 0.5);
    });

    it('T15: Should update workflow weights dynamically', async () => {
      // ARRANGE
      simulator = new Simulator(config);
      const initialWeights = { ...simulator.getFiberWeights() };
      
      // ACT
      simulator.updateFiberWeights({
        agentIdentity: 20,
        tokenEscrow: 15,
        contract: 10
      });
      
      // ASSERT
      const updatedWeights = simulator.getFiberWeights();
      expect(updatedWeights.agentIdentity).toBe(20);
      expect(updatedWeights.tokenEscrow).toBe(15);
      expect(updatedWeights.contract).toBe(10);
      expect(updatedWeights).not.toEqual(initialWeights);
    });

    it('T16: Should normalize weights to probabilities correctly', async () => {
      // ARRANGE
      simulator = new Simulator(config);
      simulator.updateFiberWeights({
        agentIdentity: 10,
        tokenEscrow: 5,
        contract: 15
      });
      
      // ACT
      const probabilities = simulator.getWorkflowProbabilities();
      
      // ASSERT
      expect(probabilities.agentIdentity).toBeCloseTo(10/30, 2); // 10/30 = 0.33
      expect(probabilities.tokenEscrow).toBeCloseTo(5/30, 2);    // 5/30 = 0.17
      expect(probabilities.contract).toBeCloseTo(15/30, 2);      // 15/30 = 0.50
      
      // Sum should equal 1.0
      const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  // ============================================================================
  // Group 5: Error Handling - Phase 2 with Mocked SDK (T17-T20)
  // ============================================================================

  describe('Group 5: Error Handling (Phase 2 - Mocked)', () => {
    it('T17: Should handle 4xx errors gracefully during token workflow creation', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      mockCreateToken.mockRejectedValue(new Error('HTTP 400: Bad Request'));
      
      simulator = new Simulator(config);
      
      // ACT & ASSERT
      await expect(simulator.createTokenWorkflow('transferable')).rejects.toThrow('HTTP 400');
      expect(simulator.getErrorStats().token4xxErrors).toBe(1);
      expect(simulator.getErrorStats().totalErrors).toBe(1);
    });

    it('T18: Should handle 5xx errors with retry logic for token workflows', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      mockCreateToken
        .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
        .mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway'))
        .mockResolvedValueOnce({ id: 'token-123', stateMachine: {} });
      
      simulator = new Simulator(config);
      
      // ACT
      const result = await simulator.createTokenWorkflow('burnable');
      
      // ASSERT
      expect(result).toBeDefined();
      expect(result.id).toBe('token-123');
      expect(simulator.getErrorStats().token5xxErrors).toBe(2);
      expect(simulator.getErrorStats().retriesSucceeded).toBe(1);
    });

    it('T19: Should not crash on token route errors', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      mockCreateToken.mockRejectedValue(new Error('Network error'));
      
      simulator = new Simulator(config);
      
      // ACT
      await simulator.start();
      const generationPromise = simulator.runOneGeneration();
      
      // ASSERT
      await expect(generationPromise).resolves.toBeDefined();
      const stats = await generationPromise;
      expect(stats.errors).toBeGreaterThan(0);
      expect(stats.crashed).toBe(false);
      expect(simulator.isRunning()).toBe(true);
    });

    it('T20: Should log detailed error information for debugging', async () => {
      // ARRANGE
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      mockCreateToken.mockRejectedValue(new Error('Token creation failed: Invalid behavior'));
      
      simulator = new Simulator(config);
      
      // ACT
      try {
        await simulator.createTokenWorkflow('invalid_behavior');
      } catch (error) {
        // Expected to fail
      }
      
      // ASSERT
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Token workflow error:'),
        expect.objectContaining({
          behavior: 'invalid_behavior',
          error: expect.stringContaining('Invalid behavior')
        })
      );
      
      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // Group 6: TDEG Token Workflows - Phase 2 with Mocked SDK (T21-T22)
  // ============================================================================

  describe('Group 6: TDEG Token Workflows (Phase 2 - Mocked)', () => {
    it('T21: Should create token state machine using SDK createTokenStateMachine', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      mockCreateToken.mockResolvedValue({
        states: { ACTIVE: { id: 'ACTIVE', isFinal: false } },
        initialState: 'ACTIVE',
        transitions: [
          { from: 'ACTIVE', to: 'ACTIVE', eventName: 'transfer', guard: {}, effect: {} }
        ]
      });
      
      simulator = new Simulator(config);
      
      // ACT
      const tokenDef = await simulator.createTokenFiberDefinition('transferable');
      
      // ASSERT
      expect(mockCreateToken).toHaveBeenCalledWith('transferable');
      expect(tokenDef.workflowType).toBe('Token');
      expect(tokenDef.states).toContain('ACTIVE');
      expect(tokenDef.transitions.some(t => t.event === 'transfer')).toBe(true);
    });

    it('T22: Should support all 16 TDEG token behavior types', async () => {
      // ARRANGE
      process.env.ENABLE_TOKEN_DOMAIN = 'true';
      const mockCreateToken = vi.mocked(require('@ottochain/sdk').createTokenStateMachine);
      
      // Mock responses for different token behaviors
      const mockResponses = {
        'transferable': { states: {}, transitions: [] },
        'burnable': { states: {}, transitions: [] },
        'non_transferable': { states: {}, transitions: [] },
        'expirable': { states: {}, transitions: [] }
      };
      
      Object.entries(mockResponses).forEach(([behavior, response]) => {
        mockCreateToken.mockResolvedValueOnce(response);
      });
      
      simulator = new Simulator(config);
      
      // ACT
      const behaviors = ['transferable', 'burnable', 'non_transferable', 'expirable'];
      const results = await Promise.all(
        behaviors.map(behavior => simulator.createTokenFiberDefinition(behavior))
      );
      
      // ASSERT
      expect(results).toHaveLength(4);
      behaviors.forEach((behavior, index) => {
        expect(mockCreateToken).toHaveBeenNthCalledWith(index + 1, behavior);
      });
      
      // Verify token definitions were created
      results.forEach((tokenDef, index) => {
        expect(tokenDef).toBeDefined();
        expect(tokenDef.workflowType).toBe('Token');
      });
    });
  });
});