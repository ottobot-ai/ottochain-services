/**
 * Agent Discovery — Unit Tests
 *
 * Tests for the discoverAgents() filter/ranking logic.
 * No live cluster needed — pure function tests.
 *
 * Run: node --test --experimental-strip-types test/agent-discovery.test.ts
 *
 * Card: Design OpenClaw skill architecture for OttoChain integration (6986f899)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  discoverAgents,
  isAgentIdentity,
  hasCapability,
  meetsReputationThreshold,
  isInState,
  type RawAgentStateMachine,
  type DiscoverQuery,
} from '../src/lib/agent-discovery.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{
  schema: string;
  definitionName: string;
  state: string;
  reputation: number;
  capabilities: { name: string }[];
  displayName: string;
  platform: string;
}>): RawAgentStateMachine {
  const {
    schema = 'AgentIdentity',
    definitionName = 'AgentIdentity',
    state = 'ACTIVE',
    reputation = 0,
    capabilities = [],
    displayName = 'TestAgent',
    platform = 'openclaw',
  } = overrides;
  return {
    currentState: state,
    stateData: {
      schema,
      displayName,
      platform,
      reputation,
      capabilities,
    },
    definition: {
      metadata: { name: definitionName },
    },
    updatedAt: '2026-03-04T00:00:00Z',
  };
}

const DEFAULT_QUERY: DiscoverQuery = {
  capability: undefined,
  minReputation: 0,
  state: 'ACTIVE',
  limit: 10,
};

// ─────────────────────────────────────────────────────────────────────────────
// isAgentIdentity
// ─────────────────────────────────────────────────────────────────────────────

describe('isAgentIdentity()', () => {
  it('returns true when stateData.schema is AgentIdentity', () => {
    const sm = makeAgent({ schema: 'AgentIdentity' });
    assert.ok(isAgentIdentity(sm));
  });

  it('returns true when definition.metadata.name is AgentIdentity', () => {
    const sm: RawAgentStateMachine = {
      stateData: { schema: 'Other' },
      definition: { metadata: { name: 'AgentIdentity' } },
    };
    assert.ok(isAgentIdentity(sm));
  });

  it('returns false for non-agent state machines', () => {
    const sm: RawAgentStateMachine = {
      stateData: { schema: 'Contract' },
      definition: { metadata: { name: 'Contract' } },
    };
    assert.ok(!isAgentIdentity(sm));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasCapability
// ─────────────────────────────────────────────────────────────────────────────

describe('hasCapability()', () => {
  it('returns true when no capability filter specified', () => {
    const sm = makeAgent({ capabilities: [] });
    assert.ok(hasCapability(sm, undefined));
  });

  it('returns true when agent has the requested capability', () => {
    const sm = makeAgent({ capabilities: [{ name: 'research' }] });
    assert.ok(hasCapability(sm, 'research'));
  });

  it('returns false when agent lacks the requested capability', () => {
    const sm = makeAgent({ capabilities: [{ name: 'code-review' }] });
    assert.ok(!hasCapability(sm, 'research'));
  });

  it('returns false when agent has no capabilities', () => {
    const sm = makeAgent({ capabilities: [] });
    assert.ok(!hasCapability(sm, 'research'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// meetsReputationThreshold
// ─────────────────────────────────────────────────────────────────────────────

describe('meetsReputationThreshold()', () => {
  it('returns true when reputation equals threshold', () => {
    const sm = makeAgent({ reputation: 10 });
    assert.ok(meetsReputationThreshold(sm, 10));
  });

  it('returns true when reputation exceeds threshold', () => {
    const sm = makeAgent({ reputation: 50 });
    assert.ok(meetsReputationThreshold(sm, 10));
  });

  it('returns false when reputation is below threshold', () => {
    const sm = makeAgent({ reputation: 3 });
    assert.ok(!meetsReputationThreshold(sm, 10));
  });

  it('returns true when threshold is 0 and reputation is undefined', () => {
    const sm: RawAgentStateMachine = { stateData: {} };
    assert.ok(meetsReputationThreshold(sm, 0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isInState
// ─────────────────────────────────────────────────────────────────────────────

describe('isInState()', () => {
  it('matches state case-insensitively', () => {
    const sm = makeAgent({ state: 'ACTIVE' });
    assert.ok(isInState(sm, 'active'));
    assert.ok(isInState(sm, 'ACTIVE'));
    assert.ok(isInState(sm, 'Active'));
  });

  it('returns false for wrong state', () => {
    const sm = makeAgent({ state: 'SUSPENDED' });
    assert.ok(!isInState(sm, 'ACTIVE'));
  });

  it('defaults to UNKNOWN when currentState is missing', () => {
    const sm: RawAgentStateMachine = {};
    assert.ok(isInState(sm, 'UNKNOWN'));
    assert.ok(!isInState(sm, 'ACTIVE'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverAgents — Integration of all filters
// ─────────────────────────────────────────────────────────────────────────────

describe('discoverAgents()', () => {
  const agents: Record<string, RawAgentStateMachine> = {
    'fiber-1': makeAgent({ displayName: 'ResearchBot', reputation: 42, capabilities: [{ name: 'research' }] }),
    'fiber-2': makeAgent({ displayName: 'CodeBot', reputation: 30, capabilities: [{ name: 'code-generation' }, { name: 'code-review' }] }),
    'fiber-3': makeAgent({ displayName: 'SuspendedBot', state: 'SUSPENDED', reputation: 100, capabilities: [{ name: 'research' }] }),
    'fiber-4': makeAgent({ displayName: 'NewBot', reputation: 2, capabilities: [{ name: 'research' }] }),
    'fiber-5': makeAgent({ displayName: 'ContractFiber', schema: 'Contract', definitionName: 'Contract', reputation: 99 }),
  };

  it('returns only AgentIdentity fibers', () => {
    const result = discoverAgents(agents, DEFAULT_QUERY);
    // fiber-5 (Contract) should be excluded
    assert.strictEqual(result.total, 4, 'total should count only AgentIdentity fibers');
  });

  it('filters by state (default ACTIVE)', () => {
    const result = discoverAgents(agents, DEFAULT_QUERY);
    // fiber-3 is SUSPENDED
    assert.ok(result.agents.every(a => a.state === 'ACTIVE'), 'all results should be ACTIVE');
    assert.strictEqual(result.filtered, 3, 'should find 3 active agents');
  });

  it('filters by capability', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, capability: 'research' });
    // fiber-1 and fiber-4 have 'research', fiber-2 does not
    assert.strictEqual(result.filtered, 2);
    assert.ok(result.agents.every(a => a.capabilities.some(c => c.name === 'research')));
  });

  it('filters by minReputation', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, minReputation: 35 });
    // Only fiber-1 (rep=42) qualifies; fiber-2 (30) and fiber-4 (2) do not
    assert.strictEqual(result.filtered, 1);
    assert.strictEqual(result.agents[0].displayName, 'ResearchBot');
  });

  it('sorts by reputation descending', () => {
    const result = discoverAgents(agents, DEFAULT_QUERY);
    const reps = result.agents.map(a => a.reputation);
    for (let i = 0; i < reps.length - 1; i++) {
      assert.ok(reps[i] >= reps[i + 1], 'results should be sorted by reputation descending');
    }
  });

  it('respects limit', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, limit: 1 });
    assert.strictEqual(result.agents.length, 1);
    // Should be the highest-reputation active agent
    assert.strictEqual(result.agents[0].reputation, 42);
  });

  it('returns empty array when no agents match', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, capability: 'orchestration' });
    assert.strictEqual(result.filtered, 0);
    assert.deepStrictEqual(result.agents, []);
  });

  it('includes expected fields in each result', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, capability: 'research' });
    const agent = result.agents[0];
    assert.ok('fiberId' in agent, 'fiberId required');
    assert.ok('displayName' in agent, 'displayName required');
    assert.ok('platform' in agent, 'platform required');
    assert.ok('platformUserId' in agent, 'platformUserId required');
    assert.ok('state' in agent, 'state required');
    assert.ok('reputation' in agent, 'reputation required');
    assert.ok('capabilities' in agent, 'capabilities required');
    assert.ok('lastActivity' in agent, 'lastActivity required');
  });

  it('handles empty stateMachines gracefully', () => {
    const result = discoverAgents({}, DEFAULT_QUERY);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.filtered, 0);
    assert.deepStrictEqual(result.agents, []);
  });

  it('handles SUSPENDED state query', () => {
    const result = discoverAgents(agents, { ...DEFAULT_QUERY, state: 'SUSPENDED' });
    assert.strictEqual(result.filtered, 1);
    assert.strictEqual(result.agents[0].displayName, 'SuspendedBot');
  });
});
