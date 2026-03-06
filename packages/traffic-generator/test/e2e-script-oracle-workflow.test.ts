/**
 * End-to-End Script Oracle Workflow Tests
 * 
 * Integration tests for complete script oracle workflows in traffic generation.
 * Tests the full lifecycle from script deployment to automated resolution.
 * 
 * Tests WILL FAIL until full script oracle integration is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvolutionaryTrafficGenerator } from '../src/evolutionary-traffic-generator.js';
import { BridgeClient } from '../src/bridge-client.js';

// Extended mock bridge with script capabilities
function createFullMockBridge() {
  const mockState = {
    deployedScripts: new Map<string, any>(),
    activeFibers: new Map<string, any>(),
    invocations: [] as any[],
  };

  return {
    // Agent operations
    generateWallet: vi.fn().mockImplementation(() => {
      const id = Math.random().toString(36).substring(7);
      return Promise.resolve({
        address: `DAG${id}${'0'.repeat(36 - id.length)}`,
        privateKey: 'a'.repeat(64),
        publicKey: 'pub' + id
      });
    }),
    registerAgent: vi.fn().mockImplementation((privateKey, displayName, platform, platformUserId) => {
      const fiberId = `agent-fiber-${Math.random().toString(36).substring(7)}`;
      return Promise.resolve({
        fiberId,
        address: `DAG${displayName.slice(-10)}${'0'.repeat(26)}`,
        hash: `agent-hash-${Date.now()}`
      });
    }),
    activateAgent: vi.fn().mockResolvedValue({
      hash: 'activate-hash',
      event: 'activate',
      fiberId: 'agent-fiber-123'
    }),

    // Script operations
    registerScript: vi.fn().mockImplementation((params) => {
      const scriptId = `script-${params.name}-${Math.random().toString(36).substring(7)}`;
      mockState.deployedScripts.set(scriptId, {
        ...params,
        scriptId,
        deployedAt: Date.now(),
        state: params.initialState || {}
      });
      return Promise.resolve({
        scriptId,
        owner: params.privateKey,
        name: params.name,
        hash: `script-hash-${Date.now()}`
      });
    }),

    invokeScript: vi.fn().mockImplementation((params) => {
      const script = mockState.deployedScripts.get(params.scriptId);
      if (!script) {
        return Promise.reject(new Error('Script not found'));
      }

      const invocationId = `invoke-${Math.random().toString(36).substring(7)}`;
      const invocation = {
        invocationId,
        scriptId: params.scriptId,
        inputs: params.inputs,
        context: params.context,
        timestamp: Date.now(),
        result: this.evaluateScript(script, params.inputs, params.context)
      };
      
      mockState.invocations.push(invocation);
      
      return Promise.resolve({
        invocationId,
        scriptId: params.scriptId,
        caller: params.privateKey,
        hash: `invoke-hash-${Date.now()}`
      });
    }),

    getScript: vi.fn().mockImplementation((scriptId) => {
      const script = mockState.deployedScripts.get(scriptId);
      if (!script) {
        return Promise.reject(new Error('Script not found'));
      }

      const lastInvocation = mockState.invocations
        .filter(inv => inv.scriptId === scriptId)
        .sort((a, b) => b.timestamp - a.timestamp)[0];

      return Promise.resolve({
        ...script,
        lastInvocation: lastInvocation || null
      });
    }),

    getScriptResult: vi.fn().mockImplementation(async (scriptId) => {
      const script = await this.getScript(scriptId);
      return {
        scriptId,
        name: script.metadata?.name,
        lastInvocation: script.lastInvocation,
        state: script.state
      };
    }),

    // Fiber operations
    createFiber: vi.fn().mockImplementation((params) => {
      const fiberId = `fiber-${params.definition.metadata.name}-${Math.random().toString(36).substring(7)}`;
      mockState.activeFibers.set(fiberId, {
        fiberId,
        definition: params.definition,
        stateData: params.initialData,
        currentState: params.definition.initialState,
        participants: params.participants || [],
        createdAt: Date.now()
      });
      return Promise.resolve({
        fiberId,
        hash: `fiber-hash-${Date.now()}`
      });
    }),

    transitionFiber: vi.fn().mockImplementation((params) => {
      const fiber = mockState.activeFibers.get(params.fiberId);
      if (!fiber) {
        return Promise.reject(new Error('Fiber not found'));
      }

      // Simulate state transition
      const transitions = fiber.definition.transitions || [];
      const validTransition = transitions.find(t => 
        t.from.value === fiber.currentState.value && 
        t.eventName === params.eventName
      );

      if (validTransition) {
        fiber.currentState = validTransition.to;
        fiber.lastTransition = {
          event: params.eventName,
          timestamp: Date.now(),
          payload: params.payload
        };
      }

      return Promise.resolve({
        hash: `transition-hash-${Date.now()}`,
        event: params.eventName,
        fiberId: params.fiberId
      });
    }),

    // Status
    checkSyncStatus: vi.fn().mockResolvedValue({ ready: true, allReady: true }),

    // Script evaluation logic
    evaluateScript: (script: any, inputs: any, context: any) => {
      // Mock script evaluation based on program logic
      if (script.name?.includes('Escrow')) {
        return {
          nextEvent: inputs.shouldRelease ? 'release' : 'hold',
          nextState: inputs.shouldRelease ? 'RELEASED' : 'FUNDED',
          shouldTransition: true,
          confidence: 0.95
        };
      } else if (script.name?.includes('Voting')) {
        const totalVotes = inputs.yesVotes + inputs.noVotes;
        return {
          nextEvent: totalVotes >= inputs.quorum ? 'resolve' : 'continue',
          nextState: totalVotes >= inputs.quorum 
            ? (inputs.yesVotes > inputs.noVotes ? 'APPROVED' : 'REJECTED')
            : 'OPEN',
          shouldTransition: totalVotes >= inputs.quorum,
          confidence: 0.9
        };
      } else if (script.name?.includes('Approval')) {
        return {
          nextEvent: inputs.approvals >= inputs.requiredApprovals ? 'approve' : 'wait',
          nextState: inputs.approvals >= inputs.requiredApprovals ? 'APPROVED' : 'PENDING',
          shouldTransition: inputs.approvals >= inputs.requiredApprovals || inputs.rejections > 0,
          confidence: 1.0
        };
      }
      
      return {
        shouldTransition: false,
        reason: 'Unknown script type'
      };
    }
  } as unknown as BridgeClient;
}

describe('End-to-End Script Oracle Workflow', () => {
  let generator: EvolutionaryTrafficGenerator;
  let bridge: ReturnType<typeof createFullMockBridge>;

  beforeEach(async () => {
    bridge = createFullMockBridge();
    
    const config = {
      targetPopulation: 10,
      birthRate: 2,
      deathRate: 0.05,
      activityRate: 0.6,
      proposalRate: 0.3,
      mutationRate: 0.1,
      initialTemperature: 1.0,
      temperatureDecay: 0.995,
      minTemperature: 0.1,
      generationIntervalMs: 1000,
      maxGenerations: 5, // Short test
      bridgeUrl: 'http://localhost:3030',
      ml0Url: 'http://localhost:9200',
      platforms: ['test'],
      seed: 12345,
      // Script oracle configuration
      scriptOracleRate: 0.4, // 40% of fibers use script oracles
      scriptTypes: ['escrow', 'voting', 'approval'],
      scriptTypeWeights: [0.5, 0.3, 0.2] // escrow, voting, approval
    };

    generator = new EvolutionaryTrafficGenerator(config, bridge as BridgeClient);
  });

  afterEach(() => {
    if (generator && typeof generator.stop === 'function') {
      generator.stop();
    }
  });

  describe('Script-Backed Escrow Workflow', () => {
    it('should create complete escrow workflow with script automation', async () => {
      // Force script escrow creation
      const orchestrator = generator.getOrchestrator();
      
      // Mock configuration for script escrow only
      const scriptConfig = {
        generationIntervalMs: 500,
        targetActiveFibers: 1,
        fiberWeights: {
          scriptEscrow: 100 // Only script escrow
        }
      };

      // Run workflow creation and progression
      let stats = await orchestrator.tick(); // Create script + fiber
      expect(stats.created).toBe(1);
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('Escrow'),
          program: expect.objectContaining({
            'if': expect.any(Array) // Escrow logic
          })
        })
      );
      expect(bridge.createFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({
            metadata: expect.objectContaining({
              scriptBacked: true
            })
          })
        })
      );

      // Simulate deposit
      stats = await orchestrator.tick();
      expect(bridge.invokeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            currentState: expect.any(String),
            shouldRelease: expect.any(Boolean)
          })
        })
      );

      // Simulate script-driven release
      stats = await orchestrator.tick();
      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'release'
        })
      );
    });

    it('should handle escrow timeout and automated refund', async () => {
      // Mock script returning timeout condition
      bridge.evaluateScript = vi.fn().mockReturnValue({
        nextEvent: 'timeout_refund',
        nextState: 'REFUNDED',
        shouldTransition: true,
        reason: 'Timeout exceeded'
      });

      const orchestrator = generator.getOrchestrator();
      
      // Create escrow
      await orchestrator.tick();
      
      // Script should trigger refund on timeout
      await orchestrator.tick();
      
      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'timeout_refund'
        })
      );
    });
  });

  describe('Script-Backed Voting Workflow', () => {
    it('should conduct automated multi-agent voting', async () => {
      const orchestrator = generator.getOrchestrator();
      
      // Create voting workflow
      const scriptConfig = {
        generationIntervalMs: 500,
        targetActiveFibers: 1,
        fiberWeights: {
          scriptVoting: 100
        }
      };

      // Create voting fiber with script
      let stats = await orchestrator.tick();
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('Voting'),
          program: expect.objectContaining({
            'if': expect.any(Array) // Voting logic
          })
        })
      );

      // Simulate multiple voting rounds
      for (let i = 0; i < 3; i++) {
        stats = await orchestrator.tick();
        expect(bridge.invokeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            inputs: expect.objectContaining({
              currentState: expect.any(String),
              totalVotes: expect.any(Number),
              quorum: expect.any(Number)
            })
          })
        );
      }

      // Final resolution should be automated
      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'resolve'
        })
      );
    });

    it('should handle dynamic quorum changes via script', async () => {
      // Mock script that adjusts quorum based on participation
      bridge.evaluateScript = vi.fn().mockReturnValue({
        nextEvent: 'adjust_quorum',
        nextState: 'OPEN',
        shouldTransition: true,
        newQuorum: 5, // Dynamic adjustment
        reason: 'Low participation, reducing quorum'
      });

      const orchestrator = generator.getOrchestrator();
      
      await orchestrator.tick(); // Create
      await orchestrator.tick(); // Evaluate and adjust

      expect(bridge.invokeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            currentParticipation: expect.any(Number)
          })
        })
      );
    });
  });

  describe('Script-Backed Approval Workflow', () => {
    it('should manage multi-party approval with script orchestration', async () => {
      const orchestrator = generator.getOrchestrator();
      
      const scriptConfig = {
        generationIntervalMs: 500,
        targetActiveFibers: 1,
        fiberWeights: {
          scriptApproval: 100
        }
      };

      // Create approval workflow
      let stats = await orchestrator.tick();
      expect(bridge.registerScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('Approval'),
          program: expect.objectContaining({
            'if': expect.any(Array) // Approval logic
          })
        })
      );

      // Simulate approval collection
      for (let i = 0; i < 3; i++) {
        stats = await orchestrator.tick();
        expect(bridge.invokeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            inputs: expect.objectContaining({
              approvals: expect.any(Number),
              rejections: expect.any(Number),
              requiredApprovals: expect.any(Number)
            })
          })
        );
      }

      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: expect.stringMatching(/^(approve|reject)$/)
        })
      );
    });

    it('should handle immediate rejection on single veto', async () => {
      // Mock script with veto logic
      bridge.evaluateScript = vi.fn().mockReturnValue({
        nextEvent: 'immediate_reject',
        nextState: 'REJECTED',
        shouldTransition: true,
        reason: 'Veto by critical approver'
      });

      const orchestrator = generator.getOrchestrator();
      
      await orchestrator.tick(); // Create
      await orchestrator.tick(); // Process veto

      expect(bridge.transitionFiber).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'immediate_reject'
        })
      );
    });
  });

  describe('Script Performance and Monitoring', () => {
    it('should track script invocation metrics', async () => {
      await generator.runGeneration(); // Full generation with scripts
      
      const metrics = generator.getScriptMetrics();
      
      expect(metrics).toEqual(
        expect.objectContaining({
          totalScriptsDeployed: expect.any(Number),
          totalInvocations: expect.any(Number),
          avgInvocationTime: expect.any(Number),
          successRate: expect.any(Number),
          errorRate: expect.any(Number),
          scriptTypeBreakdown: expect.objectContaining({
            escrow: expect.any(Number),
            voting: expect.any(Number),
            approval: expect.any(Number)
          })
        })
      );
    });

    it('should handle script evaluation timeouts gracefully', async () => {
      // Mock slow script
      bridge.invokeScript = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              invocationId: 'timeout-test',
              scriptId: 'slow-script',
              caller: 'DAG123',
              hash: 'timeout-hash'
            });
          }, 10000); // 10 second delay
        });
      });

      const orchestrator = generator.getOrchestrator();
      
      // Should not hang on slow scripts
      const startTime = Date.now();
      await orchestrator.tick();
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // Should timeout before 5 seconds
    });

    it('should collect script evaluation results for optimization', async () => {
      await generator.runGeneration();
      
      const evaluationData = generator.getScriptEvaluationData();
      
      expect(evaluationData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scriptId: expect.any(String),
            scriptType: expect.any(String),
            inputs: expect.any(Object),
            result: expect.any(Object),
            evaluationTimeMs: expect.any(Number),
            success: expect.any(Boolean)
          })
        ])
      );
    });
  });

  describe('Error Recovery and Fault Tolerance', () => {
    it('should recover from script deployment failures', async () => {
      // Mock deployment failure
      bridge.registerScript = vi.fn()
        .mockRejectedValueOnce(new Error('Deployment failed'))
        .mockResolvedValue({ scriptId: 'retry-success', owner: 'DAG123', name: 'RetryScript', hash: 'retry-hash' });

      const orchestrator = generator.getOrchestrator();
      
      // First attempt should fail, second should succeed
      await orchestrator.tick();
      await orchestrator.tick();
      
      expect(bridge.registerScript).toHaveBeenCalledTimes(2);
      expect(bridge.createFiber).toHaveBeenCalledTimes(1); // Only create fiber after successful script deploy
    });

    it('should handle script evaluation errors without stopping workflow', async () => {
      bridge.invokeScript = vi.fn().mockRejectedValue(new Error('Script evaluation error'));
      
      const orchestrator = generator.getOrchestrator();
      
      await orchestrator.tick(); // Create
      await orchestrator.tick(); // Try to evaluate (should handle error)
      
      // Orchestrator should continue operating
      expect(() => orchestrator.tick()).not.toThrow();
    });

    it('should fallback to manual transitions when script fails', async () => {
      // Mock script that fails after initial creation
      bridge.invokeScript = vi.fn().mockRejectedValue(new Error('Script unavailable'));
      
      const orchestrator = generator.getOrchestrator();
      
      await orchestrator.tick(); // Create with script
      await orchestrator.tick(); // Script fails, should fallback
      
      // Should still attempt transitions using fallback logic
      expect(bridge.transitionFiber).toHaveBeenCalled();
    });
  });
});