/**
 * Script Oracle Integration Tests
 *
 * Tests the script oracle lifecycle in the FiberOrchestrator:
 *   1. register via /script/register
 *   2. activate (REGISTERED → ACTIVE, no bridge call)
 *   3. invoke N times via /script/invoke
 *   4. retire when maxInvocations reached
 *
 * The @ottochain/sdk/apps module is mocked so vitest doesn't hit ESM CJS issues.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @ottochain/sdk/apps before any other imports that transitively require it
// ---------------------------------------------------------------------------
vi.mock('@ottochain/sdk/apps', () => {
  const mockDef = (name: string) => ({
    metadata: { name, description: `Mock ${name}`, version: '1.0.0' },
    states: {
      PROPOSED: { id: 'PROPOSED', isFinal: false },
      ACCEPTED: { id: 'ACCEPTED', isFinal: false },
      COMPLETED: { id: 'COMPLETED', isFinal: true },
    },
    initialState: 'PROPOSED',
    transitions: [
      {
        from: 'PROPOSED',
        to: 'ACCEPTED',
        eventName: 'accept',
        guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
        effect: { var: 'state' },
      },
      {
        from: 'ACCEPTED',
        to: 'COMPLETED',
        eventName: 'complete',
        guard: { '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] },
        effect: { var: 'state' },
      },
    ],
  });

  return {
    contracts: {
      getContractDefinition: () => mockDef('Contract'),
      getEscrowDefinition: () => mockDef('Escrow'),
    },
    markets: {
      getMarketDefinition: (_type?: string) => mockDef('Market'),
    },
    governance: {
      getDAODefinition: (_type?: string) => mockDef('DAO'),
    },
    identity: {
      getIdentityDefinition: () => mockDef('Identity'),
    },
    oracles: {
      getOracleDefinition: (_type?: string) => mockDef('Oracle'),
    },
  };
});

// ---------------------------------------------------------------------------
// Now import the actual modules (after mock is in place)
// ---------------------------------------------------------------------------
import { FiberOrchestrator, type TrafficConfig } from '../orchestrator.js';
import { BridgeClient } from '../bridge-client.js';
import { Agent } from '../types.js';
import { SCRIPT_INVOKE_COUNT } from '../script-workflows.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal agent pool — script oracle only needs 1 agent (the owner). */
const mockAgents: Agent[] = Array.from({ length: 10 }, (_, i) => ({
  privateKey: `${'a'.repeat(63)}${i}`,
  publicKey: `pub${i}`,
  address: `DAG${i}${'0'.repeat(37)}`,
  fiberId: null,
  state: 'UNREGISTERED' as const,
  fitness: { reputation: 10, completionRate: 0, networkEffect: 0, age: 0, total: 10 },
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

function createMockBridge() {
  return {
    checkSyncStatus: vi.fn().mockResolvedValue({ ready: true, allReady: true }),
    registerAgent: vi.fn().mockResolvedValue({ fiberId: 'agent-fiber-123', hash: 'h1' }),
    activateAgent: vi.fn().mockResolvedValue({ hash: 'h2' }),
    // Script oracle methods
    registerScript: vi.fn().mockResolvedValue({
      scriptId: 'script-uuid-aaaa-bbbb-cccc',
      owner: 'DAG0000000000000000000000000000000000000',
      name: 'Test Script',
      hash: 'hS1',
    }),
    invokeScript: vi.fn().mockResolvedValue({
      invocationId: 'inv-uuid-1111',
      scriptId: 'script-uuid-aaaa-bbbb-cccc',
      caller: 'DAG0000000000000000000000000000000000000',
      hash: 'hS2',
    }),
    getScript: vi.fn().mockResolvedValue(null),
    // Generic fallback (not expected for script oracle flows)
    createFiber: vi.fn().mockResolvedValue({ fiberId: 'fiber-uuid', hash: 'h9' }),
    transitionFiber: vi.fn().mockResolvedValue({ hash: 'h10' }),
    proposeContract: vi.fn().mockResolvedValue({ contractId: 'ctr', hash: 'h3' }),
    vouchForAgent: vi.fn().mockResolvedValue({ hash: 'hV' }),
  } as unknown as BridgeClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptOracle lifecycle', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let orchestrator: FiberOrchestrator;

  const makeConfig = (type: string): TrafficConfig => ({
    generationIntervalMs: 1000,
    targetActiveFibers: 1,
    fiberWeights: { [type]: 1 },
  });

  beforeEach(() => {
    bridge = createMockBridge();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // escrowScript
  // ──────────────────────────────────────────────────────────────────────────

  describe('escrowScript', () => {
    beforeEach(() => {
      orchestrator = new FiberOrchestrator(makeConfig('escrowScript'), bridge as BridgeClient, () => mockAgents);
    });

    it('tick 1: registers the script oracle', async () => {
      await orchestrator.tick();

      expect(bridge.registerScript).toHaveBeenCalledOnce();
      const [pk, program, opts] = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(typeof pk).toBe('string');
      expect(program).toHaveProperty('if'); // escrow program top-level key
      expect(opts).toMatchObject({ name: 'Escrow Release Condition' });
    });

    it('tick 2: activates (REGISTERED → ACTIVE, no bridge call)', async () => {
      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate

      expect(bridge.registerScript).toHaveBeenCalledOnce();
      expect(bridge.invokeScript).not.toHaveBeenCalled();
      expect(orchestrator.getStats().activeFibers).toBe(1);
    });

    it('tick 3+: invokes with escrow-shaped inputs', async () => {
      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1

      expect(bridge.invokeScript).toHaveBeenCalledOnce();
      const [pk, scriptId, inputs] = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(scriptId).toBe('script-uuid-aaaa-bbbb-cccc');
      expect(inputs).toHaveProperty('amount');
      expect(inputs).toHaveProperty('required');
      expect(inputs).toHaveProperty('depositorConfirmed');
      expect(inputs).toHaveProperty('beneficiaryConfirmed');
    });

    it('retires after SCRIPT_INVOKE_COUNT invocations', async () => {
      // register + activate + INVOKE_COUNT invokes + retire
      const totalTicks = 1 + 1 + SCRIPT_INVOKE_COUNT + 1;
      for (let i = 0; i < totalTicks; i++) {
        await orchestrator.tick();
      }

      expect(bridge.invokeScript).toHaveBeenCalledTimes(SCRIPT_INVOKE_COUNT);
      const stats = orchestrator.getStats();
      expect(stats.completedFibers).toBeGreaterThanOrEqual(1);
    });

    it('completed fiber appears in the completed log', async () => {
      const totalTicks = 1 + 1 + SCRIPT_INVOKE_COUNT + 1;
      for (let i = 0; i < totalTicks; i++) {
        await orchestrator.tick();
      }

      const log = orchestrator.getCompletedFiberLog();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0].type).toBe('escrowScript');
      expect(log[0].finalState).toBe('RETIRED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // votingScript
  // ──────────────────────────────────────────────────────────────────────────

  describe('votingScript', () => {
    beforeEach(() => {
      orchestrator = new FiberOrchestrator(makeConfig('votingScript'), bridge as BridgeClient, () => mockAgents);
    });

    it('tick 1: registers a voting script with correct name', async () => {
      await orchestrator.tick();

      expect(bridge.registerScript).toHaveBeenCalledOnce();
      const [, , opts] = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts).toMatchObject({ name: 'Vote Tally Oracle' });
    });

    it('tick 3: invokes with votes array input', async () => {
      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1

      expect(bridge.invokeScript).toHaveBeenCalledOnce();
      const [, , inputs] = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(inputs).toHaveProperty('votes');
      expect(Array.isArray(inputs.votes)).toBe(true);
      // Each vote has {option, weight}
      const firstVote = (inputs.votes as { option: string; weight: number }[])[0];
      expect(firstVote).toHaveProperty('option');
      expect(firstVote).toHaveProperty('weight');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // approvalScript
  // ──────────────────────────────────────────────────────────────────────────

  describe('approvalScript', () => {
    beforeEach(() => {
      orchestrator = new FiberOrchestrator(makeConfig('approvalScript'), bridge as BridgeClient, () => mockAgents);
    });

    it('tick 1: registers an approval script with correct name', async () => {
      await orchestrator.tick();

      const [, , opts] = (bridge.registerScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts).toMatchObject({ name: 'Approval Router' });
    });

    it('tick 3: invokes with yesVotes/totalVotes/threshold input', async () => {
      await orchestrator.tick(); // register
      await orchestrator.tick(); // activate
      await orchestrator.tick(); // invoke #1

      const [, , inputs] = (bridge.invokeScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(inputs).toHaveProperty('yesVotes');
      expect(inputs).toHaveProperty('totalVotes');
      expect(inputs).toHaveProperty('remainingVotes');
      expect(inputs).toHaveProperty('threshold');
      expect(typeof inputs.threshold).toBe('number');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Stats integration
  // ──────────────────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('tracks scriptOracle fibers in the fiberTypeDistribution', async () => {
      orchestrator = new FiberOrchestrator(makeConfig('votingScript'), bridge as BridgeClient, () => mockAgents);
      await orchestrator.tick(); // register

      const stats = orchestrator.getStats();
      expect(stats.activeFibers).toBe(1);
      expect(stats.fiberTypeDistribution['votingScript']).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Script Workflows unit tests (no orchestrator needed)
// ---------------------------------------------------------------------------

import {
  ESCROW_SCRIPT_PROGRAM,
  VOTING_SCRIPT_PROGRAM,
  APPROVAL_SCRIPT_PROGRAM,
  generateEscrowInputs,
  generateVotingInputs,
  generateApprovalInputs,
  SCRIPT_PROGRAMS,
  SCRIPT_INPUT_GENERATORS,
  SCRIPT_NAMES,
  SCRIPT_DESCRIPTIONS,
} from '../script-workflows.js';

describe('script-workflows', () => {
  describe('JSON Logic programs', () => {
    it('ESCROW_SCRIPT_PROGRAM has top-level if', () => {
      expect(ESCROW_SCRIPT_PROGRAM).toHaveProperty('if');
    });
    it('VOTING_SCRIPT_PROGRAM has top-level reduce', () => {
      expect(VOTING_SCRIPT_PROGRAM).toHaveProperty('reduce');
    });
    it('APPROVAL_SCRIPT_PROGRAM has top-level if', () => {
      expect(APPROVAL_SCRIPT_PROGRAM).toHaveProperty('if');
    });
  });

  describe('SCRIPT_PROGRAMS map', () => {
    it('contains all three script types', () => {
      expect(SCRIPT_PROGRAMS).toHaveProperty('escrowScript');
      expect(SCRIPT_PROGRAMS).toHaveProperty('votingScript');
      expect(SCRIPT_PROGRAMS).toHaveProperty('approvalScript');
    });
    it('references the canonical program objects', () => {
      expect(SCRIPT_PROGRAMS['escrowScript']).toBe(ESCROW_SCRIPT_PROGRAM);
      expect(SCRIPT_PROGRAMS['votingScript']).toBe(VOTING_SCRIPT_PROGRAM);
      expect(SCRIPT_PROGRAMS['approvalScript']).toBe(APPROVAL_SCRIPT_PROGRAM);
    });
  });

  describe('SCRIPT_NAMES and SCRIPT_DESCRIPTIONS', () => {
    for (const type of ['escrowScript', 'votingScript', 'approvalScript']) {
      it(`${type} has a non-empty name`, () => {
        expect(typeof SCRIPT_NAMES[type]).toBe('string');
        expect(SCRIPT_NAMES[type].length).toBeGreaterThan(0);
      });
      it(`${type} has a non-empty description`, () => {
        expect(typeof SCRIPT_DESCRIPTIONS[type]).toBe('string');
        expect(SCRIPT_DESCRIPTIONS[type].length).toBeGreaterThan(0);
      });
    }
  });

  describe('input generators', () => {
    it('generateEscrowInputs returns required fields', () => {
      const inputs = generateEscrowInputs();
      expect(inputs).toHaveProperty('amount');
      expect(inputs).toHaveProperty('required');
      expect(inputs).toHaveProperty('depositorConfirmed');
      expect(inputs).toHaveProperty('beneficiaryConfirmed');
      expect(typeof inputs.amount).toBe('number');
      expect(typeof inputs.required).toBe('number');
    });

    it('generateVotingInputs returns votes array with option/weight', () => {
      const inputs = generateVotingInputs();
      expect(Array.isArray(inputs.votes)).toBe(true);
      const vote = (inputs.votes as { option: string; weight: number }[])[0];
      expect(vote).toHaveProperty('option');
      expect(vote).toHaveProperty('weight');
      expect(typeof vote.weight).toBe('number');
    });

    it('generateVotingInputs accepts custom options', () => {
      const inputs = generateVotingInputs(['A', 'B']);
      expect((inputs.votes as { option: string }[]).map(v => v.option)).toEqual(['A', 'B']);
    });

    it('generateApprovalInputs returns required fields', () => {
      const inputs = generateApprovalInputs();
      expect(inputs).toHaveProperty('yesVotes');
      expect(inputs).toHaveProperty('totalVotes');
      expect(inputs).toHaveProperty('remainingVotes');
      expect(inputs).toHaveProperty('threshold');
      expect(inputs.threshold).toBe(0.6);
    });

    it('SCRIPT_INPUT_GENERATORS all return objects', () => {
      for (const [, gen] of Object.entries(SCRIPT_INPUT_GENERATORS)) {
        const out = gen();
        expect(typeof out).toBe('object');
        expect(out).not.toBeNull();
      }
    });
  });

  describe('SCRIPT_INVOKE_COUNT', () => {
    it('is a positive integer', () => {
      expect(Number.isInteger(SCRIPT_INVOKE_COUNT)).toBe(true);
      expect(SCRIPT_INVOKE_COUNT).toBeGreaterThan(0);
    });
  });
});
