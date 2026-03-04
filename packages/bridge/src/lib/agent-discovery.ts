/**
 * Agent Discovery — Filtering and Matching Logic
 *
 * Pure functions for filtering and ranking agent state machines by capability,
 * reputation, and state. Extracted from the /agent/discover route for testability.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentCapability {
  name: string;
  description?: string;
  version?: string;
  models?: string[];
  priceDagPerTask?: number;
  slaTargetSeconds?: number;
}

export interface RawAgentStateMachine {
  currentState?: string;
  stateData?: {
    schema?: string;
    displayName?: string;
    platform?: string;
    platformUserId?: string;
    reputation?: number;
    capabilities?: AgentCapability[];
    [key: string]: unknown;
  };
  definition?: {
    metadata?: { name?: string };
  };
  updatedAt?: string;
}

export interface DiscoverQuery {
  capability?: string;
  minReputation: number;
  state: string;
  limit: number;
}

export interface DiscoveredAgent {
  fiberId: string;
  displayName: string | null;
  platform: string | null;
  platformUserId: string | null;
  state: string;
  reputation: number;
  capabilities: AgentCapability[];
  lastActivity: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if the state machine is an AgentIdentity fiber. */
export function isAgentIdentity(sm: RawAgentStateMachine): boolean {
  return (
    sm.stateData?.schema === 'AgentIdentity' ||
    sm.definition?.metadata?.name === 'AgentIdentity'
  );
}

/** Returns true if agent has the specified capability (or if no capability filter). */
export function hasCapability(sm: RawAgentStateMachine, capability?: string): boolean {
  if (!capability) return true;
  const caps: AgentCapability[] = sm.stateData?.capabilities ?? [];
  return caps.some(c => c.name === capability);
}

/** Returns true if agent reputation meets minimum threshold. */
export function meetsReputationThreshold(sm: RawAgentStateMachine, minReputation: number): boolean {
  return (sm.stateData?.reputation ?? 0) >= minReputation;
}

/** Returns true if agent is in the target state. */
export function isInState(sm: RawAgentStateMachine, state: string): boolean {
  return (sm.currentState ?? 'UNKNOWN').toUpperCase() === state.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Filter Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter and rank agents from the metagraph checkpoint by capability and reputation.
 *
 * @param stateMachines - Record of fiberId → raw state machine from checkpoint
 * @param query         - Discovery query parameters
 * @returns             - Filtered, ranked, and shaped agent list
 */
export function discoverAgents(
  stateMachines: Record<string, RawAgentStateMachine>,
  query: DiscoverQuery
): { agents: DiscoveredAgent[]; total: number; filtered: number } {
  const allEntries = Object.entries(stateMachines);

  // Step 1: Filter to AgentIdentity fibers only
  const agentEntries = allEntries.filter(([, sm]) => isAgentIdentity(sm));

  // Step 2: Apply query filters
  const filtered = agentEntries
    .filter(([, sm]) => isInState(sm, query.state))
    .filter(([, sm]) => meetsReputationThreshold(sm, query.minReputation))
    .filter(([, sm]) => hasCapability(sm, query.capability))
    // Step 3: Sort by reputation descending
    .sort(([, a], [, b]) => (b.stateData?.reputation ?? 0) - (a.stateData?.reputation ?? 0))
    // Step 4: Apply limit
    .slice(0, query.limit);

  const agents: DiscoveredAgent[] = filtered.map(([fiberId, sm]) => ({
    fiberId,
    displayName: sm.stateData?.displayName ?? null,
    platform: sm.stateData?.platform ?? null,
    platformUserId: sm.stateData?.platformUserId ?? null,
    state: sm.currentState ?? 'UNKNOWN',
    reputation: sm.stateData?.reputation ?? 0,
    capabilities: sm.stateData?.capabilities ?? [],
    lastActivity: sm.updatedAt ?? null,
  }));

  return {
    agents,
    total: agentEntries.length,
    filtered: filtered.length,
  };
}
