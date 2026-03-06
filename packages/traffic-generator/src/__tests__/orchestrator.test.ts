/**
 * FiberOrchestrator Tests
 * 
 * Tests orchestrator logic with mocked BridgeClient.
 * Verifies SDK-compliant contract and fiber flows without live cluster.
 */

// Mock @ottochain/sdk/apps before any imports to avoid the CJS/ESM conflict in
// the SDK's dist/esm build (exports used in an ESM context → ReferenceError).
// fiber-definitions.ts uses these at module-init time, so the mock must be
// hoisted (vi.mock is automatically hoisted by vitest).
vi.mock('@ottochain/sdk/apps', () => {
  // Minimal SDKDefinition factory that satisfies fiber-definitions.ts helpers:
  //   extractStates / extractFinalStates / extractRoles / mapTransitions
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

  // Counterparty-guard helper (actor derived via deriveActor)
  const counterpartyGuard = { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] };
  const proposerGuard    = { '===': [{ var: 'event.agent' }, { var: 'state.proposer'    }] };

  return {
    contracts: {
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
    },
    markets: {
      getMarketDefinition: () =>
        mkDef('Universal Market', ['OPEN', 'RESOLVED', 'CANCELLED'], 'OPEN', ['RESOLVED', 'CANCELLED'], [
          { from: 'OPEN', to: 'RESOLVED',  eventName: 'resolve', guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
          { from: 'OPEN', to: 'CANCELLED', eventName: 'cancel',  guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
        ]),
    },
    governance: {
      getDAODefinition: () =>
        mkDef('DAO', ['PROPOSED', 'VOTING', 'EXECUTED', 'REJECTED'], 'PROPOSED', ['EXECUTED', 'REJECTED'], [
          { from: 'PROPOSED', to: 'VOTING',   eventName: 'open_voting', guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
          { from: 'VOTING',   to: 'EXECUTED', eventName: 'execute',     guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
        ]),
    },
    oracles: {
      getOracleDefinition: () =>
        mkDef('Oracle', ['REGISTERED', 'ACTIVE', 'SUSPENDED'], 'REGISTERED', ['SUSPENDED'], [
          { from: 'REGISTERED', to: 'ACTIVE',    eventName: 'activate',  guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
          { from: 'ACTIVE',     to: 'SUSPENDED', eventName: 'suspend',   guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] } },
        ]),
    },
    identity: {
      getIdentityDefinition: () =>
        mkDef('Agent Identity', ['REGISTERED', 'ACTIVE', 'REVOKED'], 'REGISTERED', ['REVOKED'], [
          { from: 'REGISTERED', to: 'ACTIVE',  eventName: 'activate', guard: { '===': [{ var: 'event.agent' }, { var: 'state.operator' }] } },
          { from: 'ACTIVE',     to: 'REVOKED', eventName: 'revoke',   guard: { '===': [{ var: 'event.agent' }, { var: 'state.operator' }] } },
        ]),
    },
  };
});

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

    // Script oracle operations
    registerScript: vi.fn().mockResolvedValue({ scriptId: 'script-uuid-aaa', owner: 'DAG0...', name: 'Test Script', hash: 'hashS1' }),
    invokeScript: vi.fn().mockResolvedValue({ invocationId: 'inv-uuid-bbb', scriptId: 'script-uuid-aaa', caller: 'DAG0...', hash: 'hashS2' }),
    getScript: vi.fn().mockResolvedValue(null),
    
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

  // ==========================================================================
  // Script Oracle Tests
  // ==========================================================================

  describe('script oracle lifecycle', () => {
    let scriptConfig: TrafficConfig;

    beforeEach(() => {
      scriptConfig = {
        ...defaultConfig,
        targetActiveFibers: 1,
        fiberWeights: { escrowScript: 1 },
      };
      orchestrator = new FiberOrchestrator(scriptConfig, bridge as BridgeClient, () => mockAgents);
    });

    it('should register a script oracle on first tick', async () => {
      await orchestrator.tick();

      expect(bridge.registerScript).toHaveBeenCalledOnce();
      const call = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toHaveProperty('if'); // escrow JSON Logic program has top-level 'if'
      expect(call[2]).toMatchObject({ name: 'Escrow Release Condition' });
    });

    it('should activate (REGISTERED → ACTIVE) on second tick', async () => {
      // Tick 1: register
      await orchestrator.tick();
      // Tick 2: activate (REGISTERED → ACTIVE, no bridge call)
      await orchestrator.tick();

      // registerScript called once; invokeScript not yet called
      expect(bridge.registerScript).toHaveBeenCalledOnce();
      expect(bridge.invokeScript).not.toHaveBeenCalled();
    });

    it('should invoke the script oracle on subsequent ticks', async () => {
      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1
      await orchestrator.tick(); // invoke #2

      expect(bridge.invokeScript).toHaveBeenCalledTimes(2);
      const invCall = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      // First arg: privateKey, second: scriptId, third: inputs
      expect(invCall[1]).toBe('script-uuid-aaa');
      // Escrow inputs have known shape
      expect(invCall[2]).toHaveProperty('amount');
      expect(invCall[2]).toHaveProperty('required');
      expect(invCall[2]).toHaveProperty('depositorConfirmed');
    });

    it('should retire after maxInvocations are reached', async () => {
      // default maxInvocations = 4 (SCRIPT_INVOKE_COUNT)
      // ticks: register, activate, invoke x4, retire
      const totalTicks = 2 + 4 + 1; // activate + invoke x4 + retire
      for (let i = 0; i < totalTicks; i++) {
        await orchestrator.tick();
      }

      expect(bridge.invokeScript).toHaveBeenCalledTimes(4);
      // After retirement, active fibers should be 0 and a new one created
      const stats = orchestrator.getStats();
      // new script should have been created to replace completed one
      expect(stats.completedFibers).toBeGreaterThanOrEqual(1);
    });

    it('should work with votingScript type', async () => {
      const votingConfig = { ...scriptConfig, fiberWeights: { votingScript: 1 } };
      orchestrator = new FiberOrchestrator(votingConfig, bridge as BridgeClient, () => mockAgents);

      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1

      expect(bridge.registerScript).toHaveBeenCalledOnce();
      const regCall = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(regCall[2]).toMatchObject({ name: 'Vote Tally Oracle' });

      expect(bridge.invokeScript).toHaveBeenCalledOnce();
      const invCall = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      // Voting inputs have 'votes' array
      expect(invCall[2]).toHaveProperty('votes');
      expect(Array.isArray(invCall[2].votes)).toBe(true);
    });

    it('should work with approvalScript type', async () => {
      const approvalConfig = { ...scriptConfig, fiberWeights: { approvalScript: 1 } };
      orchestrator = new FiberOrchestrator(approvalConfig, bridge as BridgeClient, () => mockAgents);

      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1

      const regCall = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(regCall[2]).toMatchObject({ name: 'Approval Router' });

      const invCall = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      // Approval inputs have yesVotes, totalVotes, threshold
      expect(invCall[2]).toHaveProperty('yesVotes');
      expect(invCall[2]).toHaveProperty('totalVotes');
      expect(invCall[2]).toHaveProperty('threshold');
    });

    it('should report ScriptOracle fibers in stats', async () => {
      await orchestrator.tick(); // register

      const stats = orchestrator.getStats();
      expect(stats.activeFibers).toBe(1);
    });
  });
});
