/**
 * FiberOrchestrator Tests
 * 
 * Tests orchestrator logic with mocked BridgeClient.
 * Verifies SDK-compliant contract and fiber flows without live cluster.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FiberOrchestrator, TrafficConfig } from '../orchestrator.js';
import { BridgeClient } from '../bridge-client.js';
import { Agent } from '../types.js';

// Mock wallet pool
const mockAgents: Agent[] = Array.from({ length: 10 }, (_, i) => ({
  privateKey: `${'a'.repeat(63)}${i}`,
  publicKey: `pub${i}`,
  address: `DAG${i}${'0'.repeat(37)}`,
  fiberId: null,
  state: 'UNREGISTERED' as const,
  fitness: {
    reputation: 10,
    completionRate: 0,
    networkEffect: 0,
    age: 0,
    total: 10,
  },
  meta: {
    birthGeneration: 0,
    displayName: `Agent_${i}`,
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
    isOracle: false,
    oracleResolutions: 0,
  },
}));

// Mock BridgeClient
function createMockBridge() {
  return {
    // Agent operations
    registerAgent: vi.fn().mockResolvedValue({ fiberId: 'agent-fiber-123', address: 'DAG...', hash: 'hash1' }),
    activateAgent: vi.fn().mockResolvedValue({ hash: 'hash2', event: 'activate', fiberId: 'agent-fiber-123' }),
    
    // Contract operations
    proposeContract: vi.fn().mockResolvedValue({ 
      contractId: 'contract-uuid-456', 
      proposer: 'DAG0...', 
      counterparty: 'DAG1...', 
      hash: 'hash3' 
    }),
    acceptContract: vi.fn().mockResolvedValue({ hash: 'hash4', contractId: 'contract-uuid-456', status: 'Active' }),
    submitCompletion: vi.fn().mockResolvedValue({ hash: 'hash5', contractId: 'contract-uuid-456', message: 'ok' }),
    finalizeContract: vi.fn().mockResolvedValue({ hash: 'hash6', contractId: 'contract-uuid-456', status: 'Completed' }),
    rejectContract: vi.fn().mockResolvedValue({ hash: 'hash7', contractId: 'contract-uuid-456', status: 'Rejected' }),
    disputeContract: vi.fn().mockResolvedValue({ hash: 'hash8', contractId: 'contract-uuid-456', status: 'Disputed' }),
    
    // Fiber operations
    createFiber: vi.fn().mockResolvedValue({ fiberId: 'fiber-uuid-789', hash: 'hash9' }),
    transitionFiber: vi.fn().mockResolvedValue({ hash: 'hash10', event: 'move', fiberId: 'fiber-uuid-789' }),
    transitionContract: vi.fn().mockResolvedValue({ hash: 'hash11', event: 'custom', fiberId: 'contract-uuid-456' }),
    
    // Status
    checkSyncStatus: vi.fn().mockResolvedValue({ ready: true, allReady: true }),
  } as unknown as BridgeClient;
}

const defaultConfig: TrafficConfig = {
  generationIntervalMs: 1000,
  targetActiveFibers: 5,
  fiberWeights: {
    escrow: 30,
    ticTacToe: 30,
    simpleOrder: 20,
    voting: 20,
  },
};

describe('FiberOrchestrator', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let orchestrator: FiberOrchestrator;

  beforeEach(() => {
    bridge = createMockBridge();
    orchestrator = new FiberOrchestrator(defaultConfig, bridge as BridgeClient, () => mockAgents);
  });

  describe('bootstrapAgents', () => {
    it('should register and activate agents', async () => {
      const registered = await orchestrator.bootstrapAgents(3);
      
      expect(registered).toBe(3);
      expect(bridge.registerAgent).toHaveBeenCalledTimes(3);
      expect(bridge.activateAgent).toHaveBeenCalledTimes(3);
    });

    it('should skip already registered agents on second call', async () => {
      await orchestrator.bootstrapAgents(2);
      await orchestrator.bootstrapAgents(2);
      
      // Should only register each agent once
      expect(bridge.registerAgent).toHaveBeenCalledTimes(2);
    });

    it('should handle registration errors gracefully', async () => {
      bridge.registerAgent = vi.fn()
        .mockResolvedValueOnce({ fiberId: 'f1', address: 'a1', hash: 'h1' })
        .mockRejectedValueOnce(new Error('already exists'))
        .mockResolvedValueOnce({ fiberId: 'f2', address: 'a2', hash: 'h2' });
      
      const registered = await orchestrator.bootstrapAgents(3);
      
      // 2 succeeded, 1 was already registered (not counted as new)
      expect(registered).toBe(2);
    });
  });

  describe('tick', () => {
    it('should skip when network is unhealthy', async () => {
      bridge.checkSyncStatus = vi.fn().mockResolvedValue({ ready: false });
      
      const stats = await orchestrator.tick();
      
      expect(stats.skipped).toBe(true);
      expect(stats.created).toBe(0);
      expect(bridge.proposeContract).not.toHaveBeenCalled();
    });

    it('should create fibers when below target', async () => {
      const stats = await orchestrator.tick();
      
      expect(stats.skipped).toBe(false);
      expect(stats.created).toBeGreaterThan(0);
      // Should have called either proposeContract or createFiber
      const totalCreations = 
        (bridge.proposeContract as ReturnType<typeof vi.fn>).mock.calls.length +
        (bridge.createFiber as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(totalCreations).toBeGreaterThan(0);
    });

    it('should use proposeContract for Contract workflowType', async () => {
      // Force escrow selection (Contract type)
      const escrowOnlyConfig = { ...defaultConfig, fiberWeights: { escrow: 100 } };
      orchestrator = new FiberOrchestrator(escrowOnlyConfig, bridge as BridgeClient, () => mockAgents);
      
      await orchestrator.tick();
      
      expect(bridge.proposeContract).toHaveBeenCalled();
      expect(bridge.createFiber).not.toHaveBeenCalled();
    });

    it('should use createFiber for Custom workflowType', async () => {
      // Force ticTacToe selection (Custom type)
      const customOnlyConfig = { ...defaultConfig, fiberWeights: { ticTacToe: 100 } };
      orchestrator = new FiberOrchestrator(customOnlyConfig, bridge as BridgeClient, () => mockAgents);
      
      await orchestrator.tick();
      
      expect(bridge.createFiber).toHaveBeenCalled();
      expect(bridge.proposeContract).not.toHaveBeenCalled();
    });
  });

  describe('contract lifecycle', () => {
    it('should drive contract through accept → complete → finalize', async () => {
      // Create a contract
      const escrowOnlyConfig = { ...defaultConfig, fiberWeights: { escrow: 100 }, targetActiveFibers: 1 };
      orchestrator = new FiberOrchestrator(escrowOnlyConfig, bridge as BridgeClient, () => mockAgents);
      
      // First tick creates the contract
      await orchestrator.tick();
      expect(bridge.proposeContract).toHaveBeenCalledTimes(1);
      
      // Subsequent ticks should drive it forward
      await orchestrator.tick();
      expect(bridge.acceptContract).toHaveBeenCalled();
      
      await orchestrator.tick();
      expect(bridge.submitCompletion).toHaveBeenCalled();
    });
  });

  describe('weighted selection', () => {
    it('should respect fiber weights over many selections', async () => {
      const weightedConfig: TrafficConfig = {
        ...defaultConfig,
        targetActiveFibers: 100,
        fiberWeights: {
          escrow: 50,      // Should be ~50%
          ticTacToe: 50,   // Should be ~50%
        },
      };
      orchestrator = new FiberOrchestrator(weightedConfig, bridge as BridgeClient, () => mockAgents);
      
      // Run many ticks to get distribution
      for (let i = 0; i < 20; i++) {
        await orchestrator.tick();
      }
      
      const proposeCount = (bridge.proposeContract as ReturnType<typeof vi.fn>).mock.calls.length;
      const createCount = (bridge.createFiber as ReturnType<typeof vi.fn>).mock.calls.length;
      
      // Both should have been called (rough 50/50 split)
      expect(proposeCount).toBeGreaterThan(0);
      expect(createCount).toBeGreaterThan(0);
    });
  });
});
