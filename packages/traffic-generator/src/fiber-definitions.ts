/**
 * Fiber Definitions for Traffic Generator
 *
 * Uses SDK state machine definitions directly rather than custom ones.
 * The sdkDefinition field should be passed directly to /fiber/create.
 */

// TypeScript 5.9 has issues resolving pnpm symlinked package exports under NodeNext.
// The import works at runtime - types are declared in sdk-apps.d.ts as a workaround.
// @ts-ignore Cannot find module '@ottochain/sdk/apps'
import { contracts, markets, governance, identity, oracles } from '@ottochain/sdk/apps';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionDef {
  from: string;
  to: string;
  event: string;
  actor: string;
}

export interface FiberContext {
  fiberId: string;
  generation: number;
}

export interface FiberDefinition {
  type: string;
  name: string;
  workflowType: 'Contract' | 'Market' | 'DAO' | 'Oracle' | 'AgentIdentity';
  roles: string[];
  isVariableParty: boolean;
  states: string[];
  initialState: string;
  finalStates: string[];
  transitions: TransitionDef[];
  /** The raw SDK definition - pass directly to bridge /fiber/create */
  sdkDefinition: unknown;
  generateInitialData: (participants: Map<string, string>, context: FiberContext) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SDK Definition Type
// ---------------------------------------------------------------------------

interface SDKTransition {
  from: string;
  to: string;
  eventName: string;
  guard?: unknown;
  effect?: unknown;
}

interface SDKState {
  id: string;
  isFinal: boolean;
  metadata?: unknown;
}

interface SDKDefinition {
  metadata: { name: string; description?: string; version?: string };
  states: Record<string, SDKState>;
  initialState: string;
  transitions: SDKTransition[];
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function extractStates(def: SDKDefinition): string[] {
  return Object.keys(def.states);
}

function extractFinalStates(def: SDKDefinition): string[] {
  return Object.entries(def.states)
    .filter(([, state]) => state.isFinal)
    .map(([id]) => id);
}

/**
 * Derive actor from guard expression.
 * Looks for patterns like { "===": [{ "var": "event.agent" }, { "var": "state.X" }] }
 */
function deriveActor(guard: unknown): string {
  if (!guard || typeof guard !== 'object') return 'proposer';

  const g = guard as Record<string, unknown>;

  // Check direct === comparison
  if (g['==='] && Array.isArray(g['==='])) {
    const [left, right] = g['==='] as unknown[];
    const leftVar = (left as { var?: string })?.var;
    const rightVar = (right as { var?: string })?.var;

    if (leftVar === 'event.agent' && rightVar?.startsWith('state.')) {
      return rightVar.replace('state.', '');
    }
    if (rightVar === 'event.agent' && leftVar?.startsWith('state.')) {
      return leftVar.replace('state.', '');
    }
  }

  // Check 'or' with multiple === checks (take first match)
  if (g['or'] && Array.isArray(g['or'])) {
    for (const clause of g['or']) {
      const actor = deriveActor(clause);
      if (actor !== 'proposer') return actor;
    }
  }

  // Check 'and' with nested conditions
  if (g['and'] && Array.isArray(g['and'])) {
    for (const clause of g['and']) {
      const actor = deriveActor(clause);
      if (actor !== 'proposer') return actor;
    }
  }

  return 'proposer';
}

function mapTransitions(def: SDKDefinition): TransitionDef[] {
  return def.transitions.map((t) => ({
    from: t.from,
    to: t.to,
    event: t.eventName,
    actor: deriveActor(t.guard),
  }));
}

function extractRoles(def: SDKDefinition): string[] {
  const roles = new Set<string>();
  for (const t of def.transitions) {
    roles.add(deriveActor(t.guard));
  }
  return Array.from(roles);
}

function buildDefinition(
  type: string,
  workflowType: FiberDefinition['workflowType'],
  sdkDef: unknown,
  isVariableParty: boolean,
  generateInitialData: FiberDefinition['generateInitialData']
): FiberDefinition {
  const def = sdkDef as SDKDefinition;
  return {
    type,
    name: def.metadata.name,
    workflowType,
    roles: extractRoles(def),
    isVariableParty,
    states: extractStates(def),
    initialState: def.initialState,
    finalStates: extractFinalStates(def),
    transitions: mapTransitions(def),
    sdkDefinition: sdkDef,
    generateInitialData,
  };
}

// ---------------------------------------------------------------------------
// Initial Data Generators (proven patterns from metagraph test suites)
// ---------------------------------------------------------------------------

function generateContractData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const proposer = participants.get('proposer') || '';
  const counterparty = participants.get('counterparty') || '';
  return {
    schema: 'Contract',
    proposer,
    counterparty,
    terms: {
      description: `Contract ${context.fiberId}`,
      value: 100,
    },
    completions: [],
    status: 'PROPOSED',
    proposedAt: new Date().toISOString(),
  };
}

function generateEscrowData(
  participants: Map<string, string>,
  _context: FiberContext
): Record<string, unknown> {
  const depositor = participants.get('depositor') || participants.get('proposer') || '';
  const beneficiary = participants.get('beneficiary') || participants.get('counterparty') || '';
  return {
    depositor,
    beneficiary,
    amount: 0,
  };
}

function generateMarketData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const creator = participants.get('creator') || participants.get('proposer') || '';
  return {
    question: `Will outcome ${context.fiberId} occur?`,
    creator,
    minOracles: 2,
    minReputation: 50,
    positions: [],
  };
}

function generateTokenDAOData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const creator = participants.get('creator') || participants.get('proposer') || '';
  const members = Array.from(participants.values());
  return {
    name: `Treasury DAO ${context.generation}`,
    creator,
    members,
    votingPeriodMs: 86400000,
    quorum: 50,
    proposal: {
      id: `prop-${context.fiberId}`,
      title: 'Initial Proposal',
      description: 'Test proposal for traffic generation',
      type: 'transfer',
      amount: 100,
    },
  };
}

function generateMultisigDAOData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const creator = participants.get('creator') || participants.get('proposer') || '';
  const signers = Array.from(participants.values());
  return {
    name: `Multi-sig Wallet ${context.generation}`,
    creator,
    signers,
    threshold: Math.max(2, Math.floor(signers.length / 2) + 1),
    proposal: {
      id: `prop-${context.fiberId}`,
      title: 'Multisig Action',
    },
  };
}

function generateThresholdDAOData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const creator = participants.get('creator') || participants.get('proposer') || '';
  const members = Array.from(participants.values());
  return {
    name: `Threshold DAO ${context.generation}`,
    creator,
    members,
    memberThreshold: 10,
    voteThreshold: 25,
    proposeThreshold: 50,
    proposal: {
      id: `prop-${context.fiberId}`,
      title: 'Threshold Proposal',
    },
  };
}

function generateOracleData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const creator = participants.get('creator') || participants.get('proposer') || '';
  return {
    oracleId: `oracle-${context.fiberId}`,
    creator,
    reputation: 100,
    status: 'REGISTERED',
  };
}

function generateIdentityData(
  participants: Map<string, string>,
  context: FiberContext
): Record<string, unknown> {
  const operatorId = participants.get('operator') || participants.get('proposer') || '';
  return {
    agentName: `Agent-${context.fiberId.slice(0, 8)}`,
    operatorId,
    stakeAmount: 1000,
    capabilities: ['code_review', 'content_moderation'],
  };
}

// ---------------------------------------------------------------------------
// Fiber Definitions (using SDK state machines)
// ---------------------------------------------------------------------------

export const FIBER_DEFINITIONS: Record<string, FiberDefinition> = {
  contract: buildDefinition(
    'contract',
    'Contract',
    contracts.getContractDefinition(),
    false,
    generateContractData
  ),

  escrow: buildDefinition(
    'escrow',
    'Contract',
    contracts.getEscrowDefinition(),
    false,
    generateEscrowData
  ),

  market: buildDefinition(
    'market',
    'Market',
    markets.getMarketDefinition('Universal'),
    true,
    generateMarketData
  ),

  tokenDAO: buildDefinition(
    'tokenDAO',
    'DAO',
    governance.getDAODefinition('Token'),
    true,
    generateTokenDAOData
  ),

  multisigDAO: buildDefinition(
    'multisigDAO',
    'DAO',
    governance.getDAODefinition('Multisig'),
    true,
    generateMultisigDAOData
  ),

  thresholdDAO: buildDefinition(
    'thresholdDAO',
    'DAO',
    governance.getDAODefinition('Threshold'),
    true,
    generateThresholdDAOData
  ),

  oracle: buildDefinition(
    'oracle',
    'Oracle',
    oracles.getOracleDefinition(),
    false,
    generateOracleData
  ),

  identity: buildDefinition(
    'identity',
    'AgentIdentity',
    identity.getIdentityDefinition(),
    false,
    generateIdentityData
  ),
};
