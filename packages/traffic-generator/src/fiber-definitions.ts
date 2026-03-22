/**
 * Fiber Definitions for Traffic Generator
 *
 * Uses SDK state machine definitions directly rather than custom ones.
 * The sdkDefinition field should be passed directly to /fiber/create.
 */

import { getContractDefinition, getEscrowDefinition } from '@ottochain/sdk/apps/contracts';
import { getMarketDefinition } from '@ottochain/sdk/apps/markets';
import { getGovernanceDefinition } from '@ottochain/sdk/apps/governance';
import { getIdentityDefinition } from '@ottochain/sdk/apps/identity';

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
  workflowType: 'Contract' | 'Market' | 'DAO' | 'Oracle' | 'AgentIdentity' | 'Governance' | 'CorporateEntity' | 'CorporateBoard' | 'CorporateShareholders' | 'CorporateSecurities' | 'Custom';
  roles: string[];
  isVariableParty: boolean;
  states: string[];
  initialState: string;
  finalStates: string[];
  transitions: TransitionDef[];
  /** The raw SDK definition - pass directly to bridge /fiber/create (optional for custom state machines) */
  sdkDefinition?: unknown;
  generateInitialData: (participants: Map<string, string>, context: FiberContext) => Record<string, unknown>;
  /** Optional: DAO sub-type (token, multisig, threshold) */
  daoType?: 'token' | 'multisig' | 'threshold';
  /** Optional: Market sub-type (prediction, auction, crowdfund, group_buy) */
  marketType?: string;
}

// ---------------------------------------------------------------------------
// State Data Types (used when casting generateInitialData return values)
// ---------------------------------------------------------------------------

export interface MarketStateData extends Record<string, unknown> {
  marketType: string;
}

export interface DAOStateData extends Record<string, unknown> {
  daoType: 'token' | 'multisig' | 'threshold';
  members: string[];
}

export interface GovernanceStateData extends Record<string, unknown> {
  members: Record<string, unknown>;
}

export interface CorporateEntityStateData extends Record<string, unknown> {}
export interface CorporateBoardStateData extends Record<string, unknown> {
  directors: unknown[];
  seats: { authorized: number };
}
export interface CorporateShareholdersStateData extends Record<string, unknown> {
  meetingType: string;
  eligibleVoters: unknown[];
}
export interface CorporateSecuritiesStateData extends Record<string, unknown> {}

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
    getContractDefinition(),
    false,
    generateContractData
  ),

  escrow: buildDefinition(
    'escrow',
    'Contract',
    getEscrowDefinition(),
    false,
    generateEscrowData
  ),

  market: buildDefinition(
    'market',
    'Market',
    getMarketDefinition('universal'),
    true,
    generateMarketData
  ),

  tokenDAO: buildDefinition(
    'tokenDAO',
    'DAO',
    getGovernanceDefinition('daoToken'),
    true,
    generateTokenDAOData
  ),

  multisigDAO: buildDefinition(
    'multisigDAO',
    'DAO',
    getGovernanceDefinition('daoMultisig'),
    true,
    generateMultisigDAOData
  ),

  thresholdDAO: buildDefinition(
    'thresholdDAO',
    'DAO',
    getGovernanceDefinition('daoReputation'),
    true,
    generateThresholdDAOData
  ),

  oracle: buildDefinition(
    'oracle',
    'Oracle',
    getIdentityDefinition('oracle'),
    false,
    generateOracleData
  ),

  identity: buildDefinition(
    'identity',
    'AgentIdentity',
    getIdentityDefinition('agent'),
    false,
    generateIdentityData
  ),

  // ---------------------------------------------------------------------------
  // Custom fiber types (v2 weighted distribution engine — Cards 1-4)
  // These use the generic /fiber/create path (no SDK state machine required).
  // ---------------------------------------------------------------------------

  ticTacToe: {
    type: 'ticTacToe',
    name: 'Tic-Tac-Toe Game',
    workflowType: 'Custom',
    roles: ['playerX', 'playerO'],
    isVariableParty: false,
    states: ['WAITING', 'PLAYING', 'FINISHED'],
    initialState: 'WAITING',
    finalStates: ['FINISHED'],
    transitions: [
      { from: 'WAITING', to: 'PLAYING', event: 'start', actor: 'playerX' },
      { from: 'PLAYING', to: 'FINISHED', event: 'end', actor: 'playerO' },
    ],
    sdkDefinition: undefined,
    generateInitialData: (participants, context) => ({
      gameId: context.fiberId,
      playerX: participants.get('playerX') || '',
      playerO: participants.get('playerO') || '',
      board: Array(9).fill(''),
      generation: context.generation,
    }),
  },

  simpleOrder: {
    type: 'simpleOrder',
    name: 'Simple Order',
    workflowType: 'Custom',
    roles: ['buyer', 'seller'],
    isVariableParty: false,
    states: ['PENDING', 'FILLED', 'CANCELLED'],
    initialState: 'PENDING',
    finalStates: ['FILLED', 'CANCELLED'],
    transitions: [
      { from: 'PENDING', to: 'FILLED', event: 'fill', actor: 'seller' },
      { from: 'PENDING', to: 'CANCELLED', event: 'cancel', actor: 'buyer' },
    ],
    sdkDefinition: undefined,
    generateInitialData: (participants, context) => ({
      orderId: context.fiberId,
      buyer: participants.get('buyer') || '',
      seller: participants.get('seller') || '',
      amount: Math.floor(Math.random() * 1000) + 100,
      generation: context.generation,
    }),
  },

  voting: {
    type: 'voting',
    name: 'Simple Vote',
    workflowType: 'Custom',
    roles: ['creator'],
    isVariableParty: true,
    states: ['OPEN', 'CLOSED'],
    initialState: 'OPEN',
    finalStates: ['CLOSED'],
    transitions: [
      { from: 'OPEN', to: 'CLOSED', event: 'close', actor: 'creator' },
    ],
    sdkDefinition: undefined,
    generateInitialData: (participants, context) => ({
      proposalId: context.fiberId,
      creator: participants.get('creator') || '',
      question: `Proposal ${context.generation}: approve initiative?`,
      options: ['yes', 'no', 'abstain'],
      generation: context.generation,
    }),
  },
};
