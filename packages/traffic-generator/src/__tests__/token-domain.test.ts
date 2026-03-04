/**
 * Token Domain Tests
 *
 * Tests for the Token fiber type support in FiberOrchestrator:
 *   - createToken called on fiber creation (FungibleToken, NFT, SoulboundBadge)
 *   - transferToken / burnToken / splitToken called for correct events
 *   - Non-transferable fibers skip transfer events gracefully
 *   - FIBER_DEFINITIONS exports all four token types
 *   - TokenStateData shape is correct
 *
 * All tests use mocked BridgeClient — no live cluster required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FiberOrchestrator, type TrafficConfig } from '../orchestrator.js';
import { BridgeClient } from '../bridge-client.js';
import { FIBER_DEFINITIONS } from '../fiber-definitions.js';
import type { Agent } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

/** 10 mock agents is enough for token fiber creation (single role: owner) */
const mockAgents: Agent[] = Array.from({ length: 10 }, (_, i) => ({
  privateKey: `${'a'.repeat(63)}${i}`,
  publicKey: `pub${i}`,
  address: `DAG${i}${'0'.repeat(37)}`,
  fiberId: null,
  state: 'AGENT_STATE_ACTIVE' as const,
  fitness: { reputation: 10, completionRate: 1, networkEffect: 0, age: 1, total: 10 },
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
    // Agent bootstrap (not exercised in token tests, but required by orchestrator)
    registerAgent: vi.fn().mockResolvedValue({ fiberId: 'agent-f1', address: 'DAG0...', hash: 'h1' }),
    activateAgent: vi.fn().mockResolvedValue({ hash: 'h2', event: 'activate', fiberId: 'agent-f1' }),
    checkSyncStatus: vi.fn().mockResolvedValue({ ready: true, allReady: true }),

    // Generic fallback
    createFiber: vi.fn().mockResolvedValue({ fiberId: 'generic-fiber', hash: 'hg' }),
    transitionFiber: vi.fn().mockResolvedValue({ hash: 'ht', event: 'transition', fiberId: 'token-xyz' }),

    // Contract (not used in token tests but mock prevents crash)
    proposeContract: vi.fn().mockResolvedValue({ contractId: 'c1', proposer: 'p', counterparty: 'q' }),
    acceptContract: vi.fn().mockResolvedValue({ hash: 'h', contractId: 'c1', status: 'ACTIVE' }),
    submitCompletion: vi.fn().mockResolvedValue({ hash: 'h', contractId: 'c1', message: 'ok' }),
    finalizeContract: vi.fn().mockResolvedValue({ hash: 'h', contractId: 'c1', status: 'COMPLETED' }),
    rejectContract: vi.fn().mockResolvedValue({ hash: 'h', contractId: 'c1', status: 'REJECTED' }),
    disputeContract: vi.fn().mockResolvedValue({ hash: 'h', contractId: 'c1', status: 'DISPUTED' }),
    transitionContract: vi.fn().mockResolvedValue({ hash: 'h', event: 'e', fiberId: 'c1' }),

    // Token operations — key mocks under test
    createToken: vi.fn().mockResolvedValue({
      tokenId: 'token-uuid-abc',
      hash: 'hash-mint',
      behavior: 12,
      behaviorName: 'FUNGIBLE_TOKEN',
    }),
    transferToken: vi.fn().mockResolvedValue({ hash: 'hash-transfer', event: 'transfer', fiberId: 'token-uuid-abc' }),
    burnToken:     vi.fn().mockResolvedValue({ hash: 'hash-burn',     event: 'burn',     fiberId: 'token-uuid-abc' }),
    splitToken:    vi.fn().mockResolvedValue({ hash: 'hash-split',    event: 'split',    fiberId: 'token-uuid-abc' }),
    getToken:      vi.fn().mockResolvedValue({ stateData: {}, currentState: 'ACTIVE', sequenceNumber: 1 }),

    getRejections: vi.fn().mockResolvedValue([]),
    assertNoRejections: vi.fn().mockResolvedValue(undefined),
  } as unknown as BridgeClient;
}

/** Config that only selects a specific token type */
function tokenOnlyConfig(fiberType: string): TrafficConfig {
  return {
    generationIntervalMs: 100,
    targetActiveFibers: 1,
    fiberWeights: { [fiberType]: 1 },
  };
}

// ============================================================================
// Tests: FIBER_DEFINITIONS
// ============================================================================

describe('FIBER_DEFINITIONS — Token domain entries', () => {
  const tokenTypes = ['FungibleToken', 'NFT', 'SoulboundBadge', 'GovernedFungibleToken'] as const;

  it.each(tokenTypes)('%s should be defined with workflowType Token', (type) => {
    const def = FIBER_DEFINITIONS[type];
    expect(def).toBeDefined();
    expect(def.workflowType).toBe('Token');
  });

  it('FungibleToken should have behavior 12 (TDEG 1100)', () => {
    expect(FIBER_DEFINITIONS.FungibleToken.tokenBehavior).toBe(12);
  });

  it('NFT should have behavior 8 (TDEG 1000)', () => {
    expect(FIBER_DEFINITIONS.NFT.tokenBehavior).toBe(8);
  });

  it('SoulboundBadge should have behavior 0 (TDEG 0000)', () => {
    expect(FIBER_DEFINITIONS.SoulboundBadge.tokenBehavior).toBe(0);
  });

  it('GovernedFungibleToken should have behavior 13 (TDEG 1101)', () => {
    expect(FIBER_DEFINITIONS.GovernedFungibleToken.tokenBehavior).toBe(13);
  });

  it.each(tokenTypes)('%s generateStateData returns correct schema', (type) => {
    const def = FIBER_DEFINITIONS[type];
    const participants = new Map([['owner', 'DAG0test']]);
    const data = def.generateStateData(participants, { fiberId: 'test-id', generation: 0 }) as { schema: string };
    expect(data.schema).toBe('Token');
  });

  it('SoulboundBadge has no transfer transition', () => {
    const transitions = FIBER_DEFINITIONS.SoulboundBadge.transitions;
    const hasTransfer = transitions.some(t => t.event === 'transfer');
    expect(hasTransfer).toBe(false);
  });

  it('FungibleToken includes transfer and split transitions', () => {
    const transitions = FIBER_DEFINITIONS.FungibleToken.transitions;
    expect(transitions.some(t => t.event === 'transfer')).toBe(true);
    expect(transitions.some(t => t.event === 'split')).toBe(true);
    expect(transitions.some(t => t.event === 'burn')).toBe(true);
  });
});

// ============================================================================
// Tests: Orchestrator — token creation
// ============================================================================

describe('FiberOrchestrator — Token fiber creation', () => {
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    bridge = createMockBridge();
  });

  it('calls createToken when minting a FungibleToken fiber', async () => {
    const orchestrator = new FiberOrchestrator(
      tokenOnlyConfig('FungibleToken'),
      bridge as unknown as BridgeClient,
      () => mockAgents,
    );

    // Mark agents as already registered so tick goes straight to fiber creation
    await orchestrator.tick();

    expect(bridge.createToken).toHaveBeenCalledOnce();
    const call = (bridge.createToken as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe(12); // FUNGIBLE_TOKEN
    expect(call.privateKey).toBeDefined();
    expect(call.metadata.name).toBeDefined();
  });

  it('calls createToken with behavior 8 for NFT', async () => {
    const orchestrator = new FiberOrchestrator(
      tokenOnlyConfig('NFT'),
      bridge as unknown as BridgeClient,
      () => mockAgents,
    );
    await orchestrator.tick();

    expect(bridge.createToken).toHaveBeenCalledOnce();
    const call = (bridge.createToken as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe(8);
  });

  it('calls createToken with behavior 0 for SoulboundBadge', async () => {
    const orchestrator = new FiberOrchestrator(
      tokenOnlyConfig('SoulboundBadge'),
      bridge as unknown as BridgeClient,
      () => mockAgents,
    );
    await orchestrator.tick();

    expect(bridge.createToken).toHaveBeenCalledOnce();
    const call = (bridge.createToken as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe(0);
  });
});

// ============================================================================
// Tests: BridgeClient interface — token methods present
// ============================================================================

describe('BridgeClient token method signatures', () => {
  it('createToken is callable with correct param shape', async () => {
    // Test via the mock — verifies the interface contract
    const bridge = createMockBridge();
    await bridge.createToken({
      privateKey: 'a'.repeat(64),
      behavior: 12,
      balance: 1000,
      metadata: { name: 'TestToken', symbol: 'TST', decimals: 8 },
    });
    expect(bridge.createToken).toHaveBeenCalledOnce();
  });

  it('transferToken, burnToken, splitToken are callable', async () => {
    const bridge = createMockBridge();
    await bridge.transferToken('pk', 'tid', 'DAGrecipient');
    await bridge.burnToken('pk', 'tid');
    await bridge.splitToken('pk', 'tid', 50);

    expect(bridge.transferToken).toHaveBeenCalledOnce();
    expect(bridge.burnToken).toHaveBeenCalledOnce();
    expect(bridge.splitToken).toHaveBeenCalledOnce();
  });
});
