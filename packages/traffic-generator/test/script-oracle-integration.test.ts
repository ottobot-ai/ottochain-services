/**
 * Script Oracle Integration Tests
 * 
 * TDD tests for integrating script oracles into traffic generator app types.
 * These tests verify the gap described in the card is properly filled.
 * 
 * Tests WILL FAIL until implementation is complete.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FiberOrchestrator } from '../src/orchestrator.js';
import { BridgeClient } from '../src/bridge-client.js';
import { Agent } from '../src/types.js';

// Mock agents for testing
const mockAgents: Agent[] = Array.from({ length: 5 }, (_, i) => ({
  privateKey: `${'a'.repeat(63)}${i}`,
  publicKey: `pub${i}`,
  address: `DAG${i}${'0'.repeat(37)}`,
  fiberId: `agent-fiber-${i}`,
  state: 'ACTIVE' as const,
  fitness: {
    reputation: 10,
    completionRate: 0.8,
    networkEffect: 5,
    age: 1,
    total: 15,
  },
  meta: {
    birthGeneration: 0,
    displayName: `ScriptAgent_${i}`,
    platform: 'test',
    vouchedFor: new Set<string>(),
    receivedVouches: new Set<string>(),
    activeContracts: new Set<string>(),
    completedContracts: 0,
    failedContracts: 0,
    riskTolerance: 0.5,
    activeMarkets: new Set<string>(),
    marketsCreated: 0,
    marketWins: 0,
    marketLosses: 0,
    totalMarketCommitments: 0,
    totalMarketWinnings: 0,
    isOracle: true,
    oracleResolutions: 0,
  },
}));

// Mock bridge client with script operations
function createMockBridge() {
  return {
    // Agent operations
    registerAgent: vi.fn().mockResolvedValue({ fiberId: 'agent-123', address: 'DAG...', hash: 'hash1' }),
    activateAgent: vi.fn().mockResolvedValue({ hash: 'hash2', event: 'activate', fiberId: 'agent-123' }),
    
    // Script oracle operations (NEW - these should be implemented)
    registerScript: vi.fn().mockResolvedValue({
      scriptId: 'script-uuid-123',
      owner: 'DAG0...',
      name: 'EscrowScript',
      hash: 'script-hash-1'
    }),
    invokeScript: vi.fn().mockResolvedValue({
      invocationId: 'invoke-uuid-456',
      scriptId: 'script-uuid-123',
      caller: 'DAG1...',
      hash: 'invoke-hash-2'
    }),
    getScript: vi.fn().mockResolvedValue({
      scriptId: 'script-uuid-123',
      metadata: { name: 'EscrowScript' },
      lastInvocation: { result: { nextState: 'RELEASED' } }
    }),
    
    // Fiber operations
    createFiber: vi.fn().mockResolvedValue({ fiberId: 'fiber-uuid-789', hash: 'hash3' }),
    transitionFiber: vi.fn().mockResolvedValue({ hash: 'hash4', event: 'progress', fiberId: 'fiber-uuid-789' }),
    
    // Status
    checkSyncStatus: vi.fn().mockResolvedValue({ ready: true, allReady: true }),
  } as unknown as BridgeClient;
}

describe('Script Oracle Integration', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let orchestrator: FiberOrchestrator;

  beforeEach(() => {
    bridge = createMockBridge();
  });

  describe('Script Oracle App Types', () => {
    it('should support "scriptEscrow" app type in fiber weights', async () => {
      // Test that script oracle app types can be configured in traffic weights
      const configWithScriptOracles = {
        generationIntervalMs: 1000,
        targetActiveFibers: 3,
        fiberWeights: {
          escrow: 30,
          ticTacToe: 20,
          scriptEscrow: 30,    // NEW: Script-backed escrow
          scriptVoting: 20,    // NEW: Script-backed voting
        },
      };

      expect(() => {
        orchestrator = new FiberOrchestrator(configWithScriptOracles, bridge as BridgeClient, () => mockAgents);
      }).not.toThrow();

      // Should accept script oracle app types without error
      expect(orchestrator).toBeDefined();
    });

    it('should support "scriptVoting" app type with automated resolution', async () => {
      const configWithScriptVoting = {
        generationIntervalMs: 1000,
        targetActiveFibers: 2,
        fiberWeights: {
          scriptVoting: 100, // Only script voting
        },
      };

      orchestrator = new FiberOrchestrator(configWithScriptVoting, bridge as BridgeClient, () => mockAgents);
      
      const stats = await orchestrator.tick();
      
      // Should create script-backed voting fibers
      expect(stats.skipped).toBe(false);
      expect(stats.created).toBeGreaterThan(0);
      expect(bridge.registerScript).toHaveBeenCalled();
    });

    it('should support "scriptApproval" workflow with multi-party signing', async () => {
      const configWithScriptApproval = {
        generationIntervalMs: 1000,
        targetActiveFibers: 2,
        fiberWeights: {
          scriptApproval: 100, // Only script approval workflow
        },
      };

      orchestrator = new FiberOrchestrator(configWithScriptApproval, bridge as BridgeClient, () => mockAgents);
      
      const stats = await orchestrator.tick();
      
      // Should create script-backed approval workflows
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.objectContaining({
            // Should contain JSON Logic for approval workflow
          }),
          name: expect.stringContaining('Approval'),
        })
      );
    });
  });

  describe('Script Deployment Integration', () => {
    beforeEach(() => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 5,
        fiberWeights: {
          scriptEscrow: 100,
        },
      };
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);
    });

    it('should deploy script before creating script-backed fiber', async () => {
      await orchestrator.tick();

      // Should deploy script first
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.any(Object), // JSON Logic program
          name: expect.any(String),
          initialState: expect.any(Object),
        })
      );
      
      // Then create fiber with script reference
      expect(bridge.createFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({
            metadata: expect.objectContaining({
              scriptId: 'script-uuid-123', // References deployed script
            }),
          }),
        })
      );
    });

    it('should deploy different script types based on app type', async () => {
      // Test escrow script deployment
      await orchestrator.tick();
      
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.objectContaining({
            // Should contain escrow-specific JSON Logic
            'if': expect.any(Object), // Escrow release conditions
          }),
          name: expect.stringMatching(/escrow/i),
        })
      );
    });

    it('should handle script deployment failures gracefully', async () => {
      bridge.registerScript = vi.fn().mockRejectedValue(new Error('Script deployment failed'));
      
      const stats = await orchestrator.tick();
      
      // Should not create fiber if script deployment fails
      expect(stats.created).toBe(0);
      expect(bridge.createFiber).not.toHaveBeenCalled();
    });
  });

  describe('Automated Script Evaluation', () => {
    beforeEach(() => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 3,
        fiberWeights: {
          scriptEscrow: 100,
        },
      };
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);
    });

    it('should invoke script to determine next transition', async () => {
      // Create initial script-backed fiber
      await orchestrator.tick();
      
      // Mock script returning next state
      bridge.getScript = vi.fn().mockResolvedValue({
        scriptId: 'script-uuid-123',
        lastInvocation: {
          result: {
            nextEvent: 'release_funds',
            nextState: 'RELEASED',
            shouldTransition: true,
          }
        }
      });

      // Next tick should invoke script and transition based on result
      await orchestrator.tick();

      expect(bridge.invokeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptId: 'script-uuid-123',
          inputs: expect.objectContaining({
            currentState: expect.any(String),
            fiberData: expect.any(Object),
          }),
        })
      );

      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'release_funds',
        })
      );
    });

    it('should pass fiber context to script invocations', async () => {
      await orchestrator.tick(); // Create fiber
      await orchestrator.tick(); // Drive with script

      expect(bridge.invokeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            currentState: expect.any(String),
            fiberData: expect.any(Object),
            participants: expect.any(Object),
            timestamp: expect.any(Number),
          }),
          context: expect.objectContaining({
            fiberType: expect.any(String),
            generationId: expect.any(Number),
          }),
        })
      );
    });

    it('should handle script evaluation errors without crashing', async () => {
      await orchestrator.tick(); // Create fiber
      
      bridge.invokeScript = vi.fn().mockRejectedValue(new Error('Script evaluation failed'));
      
      const stats = await orchestrator.tick(); // Try to drive
      
      // Should handle error gracefully
      expect(stats.driven).toBe(0);
      // Should not crash orchestrator
      expect(orchestrator).toBeDefined();
    });

    it('should support conditional transitions based on script results', async () => {
      await orchestrator.tick(); // Create fiber
      
      // Mock script returning conditional result
      bridge.getScript = vi.fn().mockResolvedValue({
        scriptId: 'script-uuid-123',
        lastInvocation: {
          result: {
            shouldTransition: false, // Script says don't transition yet
            reason: 'Waiting for timeout',
            nextCheck: Date.now() + 5000,
          }
        }
      });

      const stats = await orchestrator.tick();
      
      // Should not transition if script says no
      expect(bridge.transitionFiber).not.toHaveBeenCalled();
      expect(stats.driven).toBe(0);
    });
  });

  describe('Bridge Endpoint Integration', () => {
    it('should use script deployment endpoints', async () => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 2,
        fiberWeights: { scriptEscrow: 100 },
      };
      
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);
      await orchestrator.tick();

      // Should call the script deployment endpoint
      expect(bridge.registerScript).toHaveBeenCalledTimes(1);
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: expect.stringMatching(/^[a-f0-9]{64}$/),
          program: expect.any(Object),
          name: expect.any(String),
        })
      );
    });

    it('should use script invocation endpoints for transitions', async () => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 1,
        fiberWeights: { scriptEscrow: 100 },
      };
      
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);
      
      await orchestrator.tick(); // Create
      await orchestrator.tick(); // Drive
      
      expect(bridge.invokeScript).toHaveBeenCalled();
      expect(bridge.getScript).toHaveBeenCalledWith('script-uuid-123');
    });
  });

  describe('End-to-End Script Oracle Workflows', () => {
    it('should complete full script-backed escrow workflow', async () => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 1,
        fiberWeights: { scriptEscrow: 100 },
      };
      
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);

      // Mock progressive script results
      let invocationCount = 0;
      bridge.getScript = vi.fn().mockImplementation(() => {
        invocationCount++;
        if (invocationCount === 1) {
          return Promise.resolve({
            lastInvocation: { result: { nextEvent: 'deposit', nextState: 'FUNDED' } }
          });
        } else if (invocationCount === 2) {
          return Promise.resolve({
            lastInvocation: { result: { nextEvent: 'release', nextState: 'COMPLETED' } }
          });
        }
        return Promise.resolve({ lastInvocation: { result: { shouldTransition: false } } });
      });

      // Run workflow to completion
      let stats = await orchestrator.tick(); // Create + deploy script
      expect(stats.created).toBe(1);
      
      stats = await orchestrator.tick(); // First transition (deposit)
      expect(stats.driven).toBe(1);
      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'deposit' })
      );

      stats = await orchestrator.tick(); // Second transition (release)
      expect(stats.driven).toBe(1);
      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'release' })
      );
    });

    it('should track script oracle performance metrics', async () => {
      const configWithScripts = {
        generationIntervalMs: 1000,
        targetActiveFibers: 2,
        fiberWeights: { scriptVoting: 100 },
      };
      
      orchestrator = new FiberOrchestrator(configWithScripts, bridge as BridgeClient, () => mockAgents);
      
      await orchestrator.tick(); // Create fibers
      await orchestrator.tick(); // Drive with scripts

      // Should track script usage metrics (this will fail until implemented)
      const metrics = orchestrator.getScriptMetrics();
      
      expect(metrics).toEqual(
        expect.objectContaining({
          scriptsDeployed: expect.any(Number),
          scriptInvocations: expect.any(Number),
          scriptSuccesses: expect.any(Number),
          scriptFailures: expect.any(Number),
          avgScriptEvaluationTime: expect.any(Number),
        })
      );
    });
  });
});