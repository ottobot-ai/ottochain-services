import { FiberDefinition } from './types';

export interface FiberDefinition {
  type: string;
  name: string;
  roles: string[];  // e.g., ['buyer', 'seller'] or ['player1', 'player2']
  isVariableParty: boolean;  // true for voting, multi-sig
  transitions: TransitionDef[];
}

interface TransitionDef {
  from: string;
  event: string;
  actor: string; // role name
}

export const FIBER_DEFINITIONS: Record<string, FiberDefinition> = {
  escrow: {
    type: 'escrow',
    name: 'Simple Escrow',
    roles: ['buyer', 'seller'],
    isVariableParty: false,
    transitions: [
      { from: 'proposed', event: 'accept', actor: 'seller' },
      { from: 'active', event: 'deliver', actor: 'seller' },
      { from: 'delivered', event: 'confirm', actor: 'buyer' },
    ],
  },
  arbitratedEscrow: {
    type: 'arbitratedEscrow',
    name: 'Escrow with Arbiter',
    roles: ['buyer', 'seller', 'arbiter'],
    isVariableParty: false,
    transitions: [
      { from: 'proposed', event: 'accept', actor: 'seller' },
      { from: 'active', event: 'deliver', actor: 'seller' },
      { from: 'delivered', event: 'confirm', actor: 'buyer' },
      { from: 'disputed', event: 'resolve', actor: 'arbiter' },
    ],
  },
  ticTacToe: {
    type: 'ticTacToe',
    name: 'Tic-Tac-Toe Game',
    roles: ['playerX', 'playerO'],
    isVariableParty: false,
    transitions: [
      { from: 'xTurn', event: 'move', actor: 'playerX' },
      { from: 'oTurn', event: 'move', actor: 'playerO' },
      // ... alternates until win/draw
    ],
  },
  simpleOrder: {
    type: 'simpleOrder',
    name: 'Simple Order',
    roles: ['buyer', 'seller'],
    isVariableParty: false,
    transitions: [
      { from: 'created', event: 'confirm', actor: 'seller' },
      { from: 'confirmed', event: 'ship', actor: 'seller' },
      { from: 'shipped', event: 'deliver', actor: 'seller' },
    ],
  },
  voting: {
    type: 'voting',
    name: 'Multi-Party Vote',
    roles: ['proposer', 'voter'],  // voter is variable count
    isVariableParty: true,
    transitions: [
      { from: 'proposed', event: 'vote', actor: 'voter' },  // each voter
      { from: 'voting', event: 'tally', actor: 'proposer' },
    ],
  },
  approval: {
    type: 'approval',
    name: 'Approval Workflow',
    roles: ['requester', 'approver1', 'approver2'],
    isVariableParty: false,
    transitions: [
      { from: 'draft', event: 'submit', actor: 'requester' },
      { from: 'submitted', event: 'approve_l1', actor: 'approver1' },
      { from: 'level1Approved', event: 'approve_l2', actor: 'approver2' },
      { from: 'level2Approved', event: 'finalize', actor: 'requester' },
    ],
  },
};
