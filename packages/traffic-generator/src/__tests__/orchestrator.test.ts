/**
 * FiberOrchestrator Tests
 * 
 * Tests orchestrator logic with mocked BridgeClient.
 * Verifies SDK-compliant contract and fiber flows without live cluster.
 */

// Mock SDK app modules before any imports. fiber-definitions.ts uses these at
// module-init time, so the mocks must be hoisted (vi.mock is auto-hoisted).
// vi.hoisted ensures helpers are available in the hoisted mock factories.

const { mkDef, counterpartyGuard, proposerGuard, creatorGuard, operatorGuard } = vi.hoisted(() => {
  const mkDef = (
    name: string,
    states: string[],
    initial: string,
    finals: string[],
    transitions: { from: string; to: string; eventName: string; guard?: unknown }[] = []
  ) => ({
    metadata: { name },
    states: Object.fromEntries(
      states.map(s => [s, { id: s, isFinal: finals.includes(s) }])
    ),
    initialState: initial,
    transitions,
  });
  return {
    mkDef,
    counterpartyGuard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
    proposerGuard:     { '===': [{ var: 'event.agent' }, { var: 'state.proposer'     }] },
    creatorGuard:      { '===': [{ var: 'event.agent' }, { var: 'state.creator'      }] },
    operatorGuard:     { '===': [{ var: 'event.agent' }, { var: 'state.operator'     }] },
  };
});

vi.mock('@ottochain/sdk/apps/contracts', () => ({
  getContractDefinition: () =>
    mkDef('Contract', ['PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED'], 'PROPOSED', ['COMPLETED', 'REJECTED'], [
      { from: 'PROPOSED', to: 'ACTIVE',    eventName: 'accept',  guard: counterpartyGuard },
      { from: 'ACTIVE',   to: 'COMPLETED', eventName: 'confirm', guard: proposerGuard    },
      { from: 'PROPOSED', to: 'REJECTED',  eventName: 'reject',  guard: counterpartyGuard },
    ]),
  getEscrowDefinition: () =>
    mkDef('Escrow Contract', ['PROPOSED', 'ACTIVE', 'DELIVERED', 'COMPLETED', 'REJECTED'], 'PROPOSED', ['COMPLETED', 'REJECTED'], [
      { from: 'PROPOSED',  to: 'ACTIVE',    eventName: 'accept',  guard: counterpartyGuard },
      { from: 'ACTIVE',    to: 'DELIVERED', eventName: 'deliver', guard: counterpartyGuard },
      { from: 'DELIVERED', to: 'COMPLETED', eventName: 'confirm', guard: proposerGuard    },
      { from: 'PROPOSED',  to: 'REJECTED',  eventName: 'reject',  guard: counterpartyGuard },
    ]),
}));

vi.mock('@ottochain/sdk/apps/markets', () => ({
  getMarketDefinition: () =>
    mkDef('Universal Market', ['OPEN', 'RESOLVED', 'CANCELLED'], 'OPEN', ['RESOLVED', 'CANCELLED'], [
      { from: 'OPEN', to: 'RESOLVED',  eventName: 'resolve', guard: creatorGuard },
      { from: 'OPEN', to: 'CANCELLED', eventName: 'cancel',  guard: creatorGuard },
    ]),
}));

vi.mock('@ottochain/sdk/apps/governance', () => ({
  getGovernanceDefinition: () =>
    mkDef('DAO', ['PROPOSED', 'VOTING', 'EXECUTED', 'REJECTED'], 'PROPOSED', ['EXECUTED', 'REJECTED'], [
      { from: 'PROPOSED', to: 'VOTING',   eventName: 'open_voting', guard: creatorGuard },
      { from: 'VOTING',   to: 'EXECUTED', eventName: 'execute',     guard: creatorGuard },
    ]),
}));

vi.mock('@ottochain/sdk/apps/identity', () => ({
  getIdentityDefinition: (type?: string) =>
    type === 'oracle'
      ? mkDef('Oracle', ['REGISTERED', 'ACTIVE', 'SUSPENDED'], 'REGISTERED', ['SUSPENDED'], [
          { from: 'REGISTERED', to: 'ACTIVE',    eventName: 'activate', guard: creatorGuard },
          { from: 'ACTIVE',     to: 'SUSPENDED', eventName: 'suspend',  guard: creatorGuard },
        ])
      : mkDef('Agent Identity', ['REGISTERED', 'ACTIVE', 'REVOKED'], 'REGISTERED', ['REVOKED'], [
          { from: 'REGISTERED', to: 'ACTIVE',  eventName: 'activate', guard: operatorGuard },
          { from: 'ACTIVE',     to: 'REVOKED', eventName: 'revoke',   guard: operatorGuard },
        ]),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FiberOrchestrator, TrafficConfig } from '../orchestrator.js';
import { BridgeClient } from '../bridge-client.js';
import { Agent } from '../types.js';

// Mock wallet pool - 40 agents allows 20 fiber creations (2 agents each)
// This gives enough samples for weighted distribution tests
const mockAgents: Agent[] = Array.from({ length: 40 }, (_, i) => ({
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
    acceptContract: vi.fn().mockResolvedValue({ hash: 'hash4', contractId: 'contract-uuid-456', status: 'ACTIVE' }),
    submitCompletion: vi.fn().mockResolvedValue({ hash: 'hash5', contractId: 'contract-uuid-456', message: 'ok' }),
    finalizeContract: vi.fn().mockResolvedValue({ hash: 'hash6', contractId: 'contract-uuid-456', status: 'COMPLETED' }),
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
        targetActiveFibers: 20,  // Match available agents (40 agents / 2 per fiber)
        fiberWeights: {
          escrow: 50,      // Should be ~50%
          ticTacToe: 50,   // Should be ~50%
        },
      };
      orchestrator = new FiberOrchestrator(weightedConfig, bridge as BridgeClient, () => mockAgents);
      
      // Single tick creates up to 20 fibers (40 agents / 2 each)
      // With 50/50 weights over 20 samples, probability of all same type is ~0.0002%
      await orchestrator.tick();
      
      const proposeCount = (bridge.proposeContract as ReturnType<typeof vi.fn>).mock.calls.length;
      const createCount = (bridge.createFiber as ReturnType<typeof vi.fn>).mock.calls.length;
      
      // Both should have been called (rough 50/50 split)
      expect(proposeCount).toBeGreaterThan(0);
      expect(createCount).toBeGreaterThan(0);
      // Combined should equal 20 (all available agent pairs used)
      expect(proposeCount + createCount).toBe(20);
    });
  });

  // =========================================================================
  // Issue #178: Tests for orchestrator methods added in PR #175
  // =========================================================================

  describe('updateWeights', () => {
    it('should update weights for valid input', async () => {
      orchestrator.updateWeights({ escrow: 50, ticTacToe: 50 });
      const weights = orchestrator.getWeights();
      expect(weights.escrow).toBe(50);
      expect(weights.ticTacToe).toBe(50);
    });

    it('should reject negative weights (leave existing unchanged)', () => {
      orchestrator.updateWeights({ escrow: 30, ticTacToe: 30, simpleOrder: 20, voting: 20 });
      const before = orchestrator.getWeights();
      // Attempt to set a negative value — should be ignored
      orchestrator.updateWeights({ escrow: -10 });
      const after = orchestrator.getWeights();
      expect(after.escrow).toBe(before.escrow);
    });

    it('should preserve unspecified weights when doing partial update', () => {
      orchestrator.updateWeights({ escrow: 99 });
      const weights = orchestrator.getWeights();
      // escrow updated
      expect(weights.escrow).toBe(99);
      // others preserved from default config
      expect(weights.ticTacToe).toBe(defaultConfig.fiberWeights.ticTacToe);
      expect(weights.simpleOrder).toBe(defaultConfig.fiberWeights.simpleOrder);
      expect(weights.voting).toBe(defaultConfig.fiberWeights.voting);
    });

    it('should accept weight of 0 (disable a fiber type)', () => {
      orchestrator.updateWeights({ escrow: 0 });
      const weights = orchestrator.getWeights();
      expect(weights.escrow).toBe(0);
    });
  });

  describe('getWeights', () => {
    it('should return current weight config matching initial config', () => {
      const weights = orchestrator.getWeights();
      expect(weights).toEqual(defaultConfig.fiberWeights);
    });

    it('should return a copy (mutation does not affect internal state)', () => {
      const weights = orchestrator.getWeights();
      weights.escrow = 9999;
      const weights2 = orchestrator.getWeights();
      expect(weights2.escrow).toBe(defaultConfig.fiberWeights.escrow);
    });
  });

  describe('getActiveFibers', () => {
    it('should return empty array initially', () => {
      const fibers = orchestrator.getActiveFibers();
      expect(fibers).toEqual([]);
    });

    it('should return active fibers after a tick creates them', async () => {
      await orchestrator.tick();
      const fibers = orchestrator.getActiveFibers();
      expect(fibers.length).toBeGreaterThan(0);
      expect(fibers.length).toBeLessThanOrEqual(defaultConfig.targetActiveFibers);
    });

    it('should return a copy (mutation does not affect internal state)', async () => {
      await orchestrator.tick();
      const fibers = orchestrator.getActiveFibers();
      const originalLength = fibers.length;
      fibers.splice(0); // clear the copy
      expect(orchestrator.getActiveFibers().length).toBe(originalLength);
    });

    it('each active fiber should have required fields', async () => {
      await orchestrator.tick();
      const fibers = orchestrator.getActiveFibers();
      for (const fiber of fibers) {
        expect(typeof fiber.id).toBe('string');
        expect(typeof fiber.type).toBe('string');
        expect(typeof fiber.currentState).toBe('string');
        expect(typeof fiber.startedAt).toBe('number');
        expect(typeof fiber.transitionIndex).toBe('number');
      }
    });
  });

  describe('getCompletedFiberLog', () => {
    it('should return empty array initially', () => {
      const log = orchestrator.getCompletedFiberLog();
      expect(log).toEqual([]);
    });

    it('should cap at 100 entries (ring buffer)', async () => {
      // Use config with 1-party fibers to drive many completions
      // Use ticTacToe (Custom type) which completes in a single tick
      const singleConfig: TrafficConfig = {
        ...defaultConfig,
        fiberWeights: { ticTacToe: 100 },
        targetActiveFibers: 1,
      };
      // We need many ticks — mock createFiber to immediately reach a final state
      // by having transitionFiber return a new final state on the next drive
      let fiberCounter = 0;
      const singleBridge = createMockBridge();
      singleBridge.createFiber = vi.fn().mockImplementation(() =>
        Promise.resolve({ fiberId: `fiber-${++fiberCounter}`, hash: 'h' })
      );

      const singleOrchestrator = new FiberOrchestrator(
        singleConfig,
        singleBridge as BridgeClient,
        () => mockAgents
      );

      // Drive 120 fiber completions by directly exercising the log
      // The ring buffer is internal so we force 120 ticks with a custom mock
      // that makes every newly created fiber immediately enter a final state.
      // ticTacToe's initialState is already a final state in the mock SDK:
      // The mock returns states: PROPOSED(initial), COMPLETED(final) with no transitions from PROPOSED
      // so driveFiber returns 'completed' on first drive.
      // We run 120 ticks so we exceed the 100 cap.
      for (let i = 0; i < 120; i++) {
        await singleOrchestrator.tick();
      }

      const log = singleOrchestrator.getCompletedFiberLog();
      expect(log.length).toBeLessThanOrEqual(100);
    });

    it('should return newest entry first', async () => {
      // We need at least 2 completions
      const escrowOnlyConfig: TrafficConfig = {
        ...defaultConfig,
        fiberWeights: { escrow: 100 },
        targetActiveFibers: 1,
      };
      const singleBridge = createMockBridge();
      let counter = 0;
      singleBridge.proposeContract = vi.fn().mockImplementation(() =>
        Promise.resolve({ contractId: `contract-${++counter}`, proposer: 'DAG0', counterparty: 'DAG1', hash: 'h' })
      );

      const singleOrchestrator = new FiberOrchestrator(
        escrowOnlyConfig,
        singleBridge as BridgeClient,
        () => mockAgents
      );

      // Enough ticks to complete 2 contracts: create → accept → deliver → confirm × 2
      for (let i = 0; i < 20; i++) {
        await singleOrchestrator.tick();
      }

      const log = singleOrchestrator.getCompletedFiberLog();
      if (log.length >= 2) {
        // Newer entry should have a completedAt >= older entry
        const newer = new Date(log[0].completedAt).getTime();
        const older = new Date(log[log.length - 1].completedAt).getTime();
        expect(newer).toBeGreaterThanOrEqual(older);
      }
    });

    it('each log entry should have required fields', async () => {
      // Force a fiber to complete: ticTacToe with no real transitions completes immediately
      const singleBridge = createMockBridge();
      const singleOrchestrator = new FiberOrchestrator(
        { ...defaultConfig, fiberWeights: { ticTacToe: 100 }, targetActiveFibers: 1 },
        singleBridge as BridgeClient,
        () => mockAgents
      );

      // Tick twice: first creates, second should complete and log
      await singleOrchestrator.tick();
      await singleOrchestrator.tick();

      const log = singleOrchestrator.getCompletedFiberLog();
      for (const entry of log) {
        expect(typeof entry.id).toBe('string');
        expect(typeof entry.type).toBe('string');
        expect(typeof entry.finalState).toBe('string');
        expect(typeof entry.completedAt).toBe('string');
        // completedAt should be a valid ISO date
        expect(new Date(entry.completedAt).getTime()).not.toBeNaN();
      }
    });
  });
});
