/**
 * Token Routes Unit Tests
 *
 * Tests the TDEG (Transferable, Divisible, Expirable, Governable) helper
 * functions and validation logic for the token route handlers.
 *
 * Covers: behavior flag checks, state machine construction (all 16 archetypes),
 * transferGuard combinations, requireBehaviorFlag, requireActiveState.
 *
 * Run: node --test --experimental-strip-types test/token-routes.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TOKEN_BEHAVIOR_FLAGS,
  TOKEN_BEHAVIOR_NAMES,
  isTransferable,
  isDivisible,
  isExpirable,
  isGovernable,
  transferGuard,
  createTokenStateMachine,
  requireBehaviorFlag,
  requireActiveState,
  type TokenState,
} from '../src/routes/token.js';

// ─── Behavior flag checks ─────────────────────────────────────────────────────

describe('TDEG behavior flag helpers', () => {

  it('correctly identifies TRANSFERABLE bit (0b1000 = 8)', () => {
    assert.ok(isTransferable(0b1000),  'NFT (8) is transferable');
    assert.ok(isTransferable(0b1100),  'FUNGIBLE_TOKEN (12) is transferable');
    assert.ok(isTransferable(0b1111),  'GOVERNED_EXPIRABLE_FUNGIBLE (15) is transferable');
    assert.ok(!isTransferable(0b0000), 'SOULBOUND_RECEIPT (0) is NOT transferable');
    assert.ok(!isTransferable(0b0111), 'GOVERNED_EXPIRABLE_POINTS (7) is NOT transferable');
  });

  it('correctly identifies DIVISIBLE bit (0b0100 = 4)', () => {
    assert.ok(isDivisible(0b0100),  'LOYALTY_POINTS (4) is divisible');
    assert.ok(isDivisible(0b1100),  'FUNGIBLE_TOKEN (12) is divisible');
    assert.ok(!isDivisible(0b1000), 'NFT (8) is NOT divisible');
    assert.ok(!isDivisible(0b0011), 'GOVERNED_LICENSE (3) is NOT divisible');
  });

  it('correctly identifies EXPIRABLE bit (0b0010 = 2)', () => {
    assert.ok(isExpirable(0b0010),  'EXPIRABLE_CREDENTIAL (2) is expirable');
    assert.ok(isExpirable(0b1110),  'EXPIRABLE_FUNGIBLE_TOKEN (14) is expirable');
    assert.ok(!isExpirable(0b0000), 'SOULBOUND_RECEIPT (0) is NOT expirable');
    assert.ok(!isExpirable(0b1100), 'FUNGIBLE_TOKEN (12) is NOT expirable');
  });

  it('correctly identifies GOVERNABLE bit (0b0001 = 1)', () => {
    assert.ok(isGovernable(0b0001),  'GOVERNED_BADGE (1) is governable');
    assert.ok(isGovernable(0b1111),  'GOVERNED_EXPIRABLE_FUNGIBLE (15) is governable');
    assert.ok(!isGovernable(0b0000), 'SOULBOUND_RECEIPT (0) is NOT governable');
    assert.ok(!isGovernable(0b1110), 'EXPIRABLE_FUNGIBLE_TOKEN (14) is NOT governable');
  });

  it('all 16 archetypes have expected behavior flags', () => {
    const expected: Array<[number, boolean, boolean, boolean, boolean]> = [
      //  b   T      D      E      G
      [  0, false, false, false, false ], // SOULBOUND_RECEIPT
      [  1, false, false, false, true  ], // GOVERNED_BADGE
      [  2, false, false, true,  false ], // EXPIRABLE_CREDENTIAL
      [  3, false, false, true,  true  ], // GOVERNED_LICENSE
      [  4, false, true,  false, false ], // LOYALTY_POINTS
      [  5, false, true,  false, true  ], // GOVERNED_ALLOCATION
      [  6, false, true,  true,  false ], // EXPIRABLE_POINTS
      [  7, false, true,  true,  true  ], // GOVERNED_EXPIRABLE_POINTS
      [  8, true,  false, false, false ], // NFT
      [  9, true,  false, false, true  ], // GOVERNED_NFT
      [ 10, true,  false, true,  false ], // EXPIRABLE_NFT
      [ 11, true,  false, true,  true  ], // GOVERNED_EXPIRABLE_NFT
      [ 12, true,  true,  false, false ], // FUNGIBLE_TOKEN
      [ 13, true,  true,  false, true  ], // GOVERNED_FUNGIBLE_TOKEN
      [ 14, true,  true,  true,  false ], // EXPIRABLE_FUNGIBLE_TOKEN
      [ 15, true,  true,  true,  true  ], // GOVERNED_EXPIRABLE_FUNGIBLE
    ];

    for (const [b, t, d, e, g] of expected) {
      const name = TOKEN_BEHAVIOR_NAMES[b];
      assert.strictEqual(isTransferable(b), t, `${name} transferable=${t}`);
      assert.strictEqual(isDivisible(b),    d, `${name} divisible=${d}`);
      assert.strictEqual(isExpirable(b),    e, `${name} expirable=${e}`);
      assert.strictEqual(isGovernable(b),   g, `${name} governable=${g}`);
    }
  });

});

// ─── transferGuard logic ──────────────────────────────────────────────────────

describe('transferGuard', () => {

  it('returns null when neither governed nor expirable', () => {
    assert.strictEqual(transferGuard(false, false), null);
  });

  it('returns GOVERNANCE_GUARD when governed only', () => {
    const guard = transferGuard(true, false) as Record<string, unknown>;
    assert.ok('var' in guard, 'Should be a var guard');
    assert.strictEqual(guard.var, 'delegation.isAuthorized');
  });

  it('returns EXPIRY_GUARD when expirable only', () => {
    const guard = transferGuard(false, true) as Record<string, unknown>;
    assert.ok('<' in guard, 'Should be a < comparison');
  });

  it('returns AND guard when both governed and expirable', () => {
    const guard = transferGuard(true, true) as { and: unknown[] };
    assert.ok(guard.and, 'Should have "and" key');
    assert.strictEqual(guard.and.length, 2, 'Should have 2 conditions');
  });

});

// ─── createTokenStateMachine ──────────────────────────────────────────────────

describe('createTokenStateMachine', () => {

  it('non-transferable tokens have no transfer transition', () => {
    const sm = createTokenStateMachine(0); // SOULBOUND_RECEIPT
    const transitions = sm.transitions as Array<{ eventName: string }>;
    const hasTransfer = transitions.some(t => t.eventName === 'transfer');
    assert.ok(!hasTransfer, 'SOULBOUND_RECEIPT should have no transfer transition');
  });

  it('transferable tokens have transfer transition', () => {
    const sm = createTokenStateMachine(8); // NFT
    const transitions = sm.transitions as Array<{ eventName: string }>;
    const hasTransfer = transitions.some(t => t.eventName === 'transfer');
    assert.ok(hasTransfer, 'NFT should have transfer transition');
  });

  it('non-divisible tokens have no split/merge transitions', () => {
    const sm = createTokenStateMachine(8); // NFT (transferable but NOT divisible)
    const transitions = sm.transitions as Array<{ eventName: string }>;
    assert.ok(!transitions.some(t => t.eventName === 'split'), 'NFT should have no split');
    assert.ok(!transitions.some(t => t.eventName === 'merge'), 'NFT should have no merge');
  });

  it('divisible tokens have split and merge transitions', () => {
    const sm = createTokenStateMachine(12); // FUNGIBLE_TOKEN
    const transitions = sm.transitions as Array<{ eventName: string }>;
    assert.ok(transitions.some(t => t.eventName === 'split'), 'FUNGIBLE_TOKEN should have split');
    assert.ok(transitions.some(t => t.eventName === 'merge'), 'FUNGIBLE_TOKEN should have merge');
  });

  it('non-expirable tokens have no EXPIRED state or expire transition', () => {
    const sm = createTokenStateMachine(8); // NFT
    assert.ok(!('EXPIRED' in sm.states), 'NFT should have no EXPIRED state');
    const transitions = sm.transitions as Array<{ eventName: string }>;
    assert.ok(!transitions.some(t => t.eventName === 'expire'), 'NFT should have no expire transition');
  });

  it('expirable tokens have EXPIRED state and expire transition', () => {
    const sm = createTokenStateMachine(10); // EXPIRABLE_NFT
    assert.ok('EXPIRED' in sm.states, 'EXPIRABLE_NFT should have EXPIRED state');
    const transitions = sm.transitions as Array<{ eventName: string }>;
    assert.ok(transitions.some(t => t.eventName === 'expire'), 'EXPIRABLE_NFT should have expire transition');
  });

  it('all tokens have burn transition and BURNED terminal state', () => {
    for (let b = 0; b <= 15; b++) {
      const sm = createTokenStateMachine(b);
      const name = TOKEN_BEHAVIOR_NAMES[b];
      assert.ok('BURNED' in sm.states, `${name} should have BURNED state`);
      const transitions = sm.transitions as Array<{ eventName: string }>;
      assert.ok(transitions.some(t => t.eventName === 'burn'), `${name} should have burn transition`);
    }
  });

  it('metadata reflects token behavior number and name', () => {
    const sm = createTokenStateMachine(15); // GOVERNED_EXPIRABLE_FUNGIBLE
    assert.strictEqual(sm.metadata.tokenBehavior, 15);
    assert.ok(sm.metadata.name.includes('GOVERNED_EXPIRABLE_FUNGIBLE'));
    assert.strictEqual(sm.metadata.category, 'token');
    assert.strictEqual(sm.metadata.version, '1.0.0');
  });

  it('governed transferable token has governance guard on transfer', () => {
    const sm = createTokenStateMachine(9); // GOVERNED_NFT (T=true, G=true)
    const transitions = sm.transitions as Array<{ eventName: string; guard: unknown }>;
    const transferTx = transitions.find(t => t.eventName === 'transfer');
    assert.ok(transferTx, 'Should have transfer transition');
    assert.ok(transferTx.guard !== null, 'Transfer guard should not be null for governed token');
    const guard = transferTx.guard as Record<string, unknown>;
    assert.strictEqual(guard.var, 'delegation.isAuthorized');
  });

  it('governed+expirable transferable token has AND guard on transfer', () => {
    const sm = createTokenStateMachine(11); // GOVERNED_EXPIRABLE_NFT
    const transitions = sm.transitions as Array<{ eventName: string; guard: unknown }>;
    const transferTx = transitions.find(t => t.eventName === 'transfer');
    assert.ok(transferTx, 'Should have transfer transition');
    const guard = transferTx.guard as { and: unknown[] };
    assert.ok(guard.and && guard.and.length === 2, 'Should have AND guard with 2 conditions');
  });

});

// ─── requireBehaviorFlag ──────────────────────────────────────────────────────

describe('requireBehaviorFlag', () => {

  it('returns error when behavior is undefined', () => {
    const state: TokenState = { stateData: {} };
    const result = requireBehaviorFlag(state, isTransferable, 'transfer');
    assert.ok(result.error, 'Should return error when behavior missing');
    assert.ok(result.error.includes('transfer'), 'Error should mention the flag');
  });

  it('returns error when behavior flag is not set', () => {
    const state: TokenState = { stateData: { behavior: 0 } }; // SOULBOUND_RECEIPT
    const result = requireBehaviorFlag(state, isTransferable, 'transfer');
    assert.ok(result.error, 'Should return error when flag not set');
  });

  it('returns empty object when behavior flag is set', () => {
    const state: TokenState = { stateData: { behavior: 8 } }; // NFT (transferable)
    const result = requireBehaviorFlag(state, isTransferable, 'transfer');
    assert.ok(!result.error, 'Should not return error when flag is set');
  });

  it('checks divisible flag correctly', () => {
    const nft: TokenState = { stateData: { behavior: 8 } };
    const fungible: TokenState = { stateData: { behavior: 12 } };
    assert.ok(requireBehaviorFlag(nft, isDivisible, 'split').error, 'NFT should fail divisible check');
    assert.ok(!requireBehaviorFlag(fungible, isDivisible, 'split').error, 'FUNGIBLE should pass divisible check');
  });

});

// ─── requireActiveState ───────────────────────────────────────────────────────

describe('requireActiveState', () => {

  it('returns no error when state is ACTIVE', () => {
    const state: TokenState = { currentState: 'ACTIVE' };
    const result = requireActiveState(state);
    assert.ok(!result.error, 'ACTIVE state should pass');
  });

  it('returns error when state is BURNED', () => {
    const state: TokenState = { currentState: 'BURNED' };
    const result = requireActiveState(state);
    assert.ok(result.error, 'BURNED state should fail');
    assert.ok(result.error.includes('BURNED'), 'Error should mention current state');
  });

  it('returns error when state is EXPIRED', () => {
    const state: TokenState = { currentState: 'EXPIRED' };
    const result = requireActiveState(state);
    assert.ok(result.error, 'EXPIRED state should fail');
    assert.ok(result.error.includes('EXPIRED'), 'Error should mention current state');
  });

  it('returns error when currentState is undefined', () => {
    const state: TokenState = {};
    const result = requireActiveState(state);
    assert.ok(result.error, 'Missing state should fail');
  });

});

// Run if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('Running token route unit tests...');
}
