/**
 * Delegation Bridge Endpoints — TDD Test Suite
 * 
 * Tests the delegation-related bridge endpoints as specified in 
 * docs/design/delegation-relayer-spec.md Groups 4-5
 * 
 * These tests are designed to FAIL until the delegation bridge
 * endpoints are fully implemented according to the specification.
 * 
 * Coverage:
 *   - Group 4: POST /delegation/submit (4 tests)
 *   - Group 5: POST /delegation/:id/revoke (2 tests)
 * 
 * Requirements:
 *   - Running OttoChain cluster (gl0, ml0, dl1)
 *   - Bridge service running on localhost:3030 (or BRIDGE_URL env)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL || 'http://localhost:9200';

// ============================================================================
// Types (Based on Delegation Relayer Spec)
// ============================================================================

interface DelegationCredential {
  delegationId: string;
  delegatorAddr: string;
  relayerAddr: string;
  sessionKeyId: string;
  scope: string[];
  spendLimit: number;
  spendUsed: number;
  expiresAtOrdinal: number;
  isRevoked: boolean;
}

interface DelegatedSubmitRequest {
  delegationId: string;
  messageType: string;
  messagePayload: Record<string, unknown>;
  sessionKeyPrivKey: string;
}

interface DelegatedSubmitResponse {
  txHash: string;
  status: 'submitted' | 'pending';
  ordinal: number;
}

interface DelegationRevokeRequest {
  delegatorPrivKey: string;
  reason?: string;
}

interface DelegationRevokeResponse {
  txHash: string;
  status: 'revoked';
  ordinal: number;
}

interface BridgeErrorResponse {
  error: string;
  message?: string;
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a test delegation credential on-chain for testing purposes.
 * This is a helper that would use the existing createDelegation SDK method.
 */
async function createTestDelegation(
  delegatorPrivKey: string,
  relayerAddr: string,
  scope: string[] = ['TRANSITION_STATE_MACHINE'],
  spendLimit: number = 1000000,
  expiresAtOrdinal: number = 999999
): Promise<string> {
  // TODO: This would use the SDK createDelegation method from PR #41
  // For now, we'll simulate creating a delegation and return a mock ID
  const response = await fetch(`${BRIDGE_URL}/delegation/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      delegatorPrivKey,
      relayerAddr,
      scope,
      spendLimit,
      expiresAtOrdinal
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create test delegation: ${response.status}`);
  }
  
  const result = await response.json();
  return result.delegationId;
}

/**
 * Gets the current checkpoint from ML0 to verify on-chain state
 */
async function getCurrentCheckpoint(): Promise<any> {
  const response = await fetch(`${ML0_URL}/checkpoint`);
  if (!response.ok) {
    throw new Error(`Failed to get checkpoint: ${response.status}`);
  }
  return response.json();
}

/**
 * Test wallet credentials for consistent testing
 */
const TEST_WALLETS = {
  delegator: {
    privateKey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    address: '0x742d35Cc6B7AdB4c4B1F6a5E1b8F0123456789Ab'
  },
  relayer: {
    privateKey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    address: '0x8Ba1f109551bD432803012645Hac189B739c9Cef'
  },
  attacker: {
    privateKey: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    address: '0xDeadbeefDeadbeefDeadbeefDeadbeefDeadbeef'
  }
};

// ============================================================================
// Group 4: POST /delegation/submit Tests
// ============================================================================

describe('Group 4: POST /delegation/submit', () => {
  
  it('Group 4.1: returns 404 when delegationId not in on-chain state', async () => {
    const nonExistentDelegationId = '00000000-0000-0000-0000-000000000000';
    
    const request: DelegatedSubmitRequest = {
      delegationId: nonExistentDelegationId,
      messageType: 'TRANSITION_STATE_MACHINE',
      messagePayload: {
        fiberId: '12345678-1234-1234-1234-123456789abc',
        event: {
          eventName: 'test_transition',
          payload: {}
        }
      },
      sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 404);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'DELEGATION_NOT_FOUND');
  });

  it('Group 4.2: returns 409 when delegation is revoked', async () => {
    // First create a delegation
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    // Revoke the delegation
    const revokeResponse = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
        reason: 'Test revocation'
      })
    });
    
    assert.ok(revokeResponse.ok, 'Revocation should succeed');
    
    // Now try to use the revoked delegation
    const request: DelegatedSubmitRequest = {
      delegationId,
      messageType: 'TRANSITION_STATE_MACHINE',
      messagePayload: {
        fiberId: '12345678-1234-1234-1234-123456789abc',
        event: {
          eventName: 'test_transition',
          payload: {}
        }
      },
      sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 409);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'DELEGATION_REVOKED');
  });

  it('Group 4.3: successfully submits OttochainMessage via session key', async () => {
    // Create a valid, active delegation
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    // Create a state machine to transition
    const createSMResponse = await fetch(`${BRIDGE_URL}/sm/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: TEST_WALLETS.delegator.privateKey,
        definition: {
          initialState: { value: 'ACTIVE' },
          states: {
            ACTIVE: {
              stateId: { value: 'ACTIVE' },
              transitions: [{
                from: { value: 'ACTIVE' },
                to: { value: 'ACTIVE' },
                eventName: 'test_transition',
                guards: [],
                effects: []
              }]
            }
          },
          transitions: {}
        },
        stateData: {},
        owners: [TEST_WALLETS.delegator.address]
      })
    });
    
    assert.ok(createSMResponse.ok, 'State machine creation should succeed');
    const createResult = await createSMResponse.json();
    
    // Submit a delegated transition
    const request: DelegatedSubmitRequest = {
      delegationId,
      messageType: 'TRANSITION_STATE_MACHINE',
      messagePayload: {
        fiberId: createResult.fiberId,
        event: {
          eventName: 'test_transition',
          payload: {}
        }
      },
      sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 200);
    
    const result: DelegatedSubmitResponse = await response.json();
    assert.ok(result.txHash, 'Should return transaction hash');
    assert.strictEqual(result.status, 'submitted');
    assert.ok(typeof result.ordinal === 'number', 'Should return ordinal');
    
    // Verify the transaction appeared on-chain
    const checkpoint = await getCurrentCheckpoint();
    const fiber = checkpoint.calculatedState.stateMachines[createResult.fiberId];
    assert.ok(fiber, 'Fiber should exist after transition');
    assert.ok(fiber.sequenceNumber > 0, 'Sequence number should have incremented');
  });

  it('Group 4.4: rejects invalid messageType', async () => {
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    const request: DelegatedSubmitRequest = {
      delegationId,
      messageType: 'NOT_A_REAL_MESSAGE', // Invalid message type
      messagePayload: {
        fiberId: '12345678-1234-1234-1234-123456789abc',
        event: {
          eventName: 'test_transition',
          payload: {}
        }
      },
      sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 400);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'INVALID_MESSAGE_TYPE');
  });
});

// ============================================================================
// Group 5: POST /delegation/:id/revoke Tests  
// ============================================================================

describe('Group 5: POST /delegation/:id/revoke', () => {

  it('Group 5.1: submits RevokeDelegation on-chain and returns revoked status', async () => {
    // Create a delegation to revoke
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    const request: DelegationRevokeRequest = {
      delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
      reason: 'Integration test revocation'
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 200);
    
    const result: DelegationRevokeResponse = await response.json();
    assert.ok(result.txHash, 'Should return transaction hash');
    assert.strictEqual(result.status, 'revoked');
    assert.ok(typeof result.ordinal === 'number', 'Should return ordinal');
    
    // Verify the delegation is revoked on-chain
    const checkpoint = await getCurrentCheckpoint();
    const delegation = checkpoint.calculatedState.delegations[delegationId];
    assert.ok(delegation, 'Delegation should exist');
    assert.strictEqual(delegation.isRevoked, true, 'Delegation should be marked as revoked');
  });

  it('Group 5.2: returns 409 if already revoked', async () => {
    // Create and revoke a delegation
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    // First revocation (should succeed)
    const firstRevoke = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
        reason: 'First revocation'
      })
    });
    
    assert.ok(firstRevoke.ok, 'First revocation should succeed');
    
    // Second revocation attempt (should fail)
    const request: DelegationRevokeRequest = {
      delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
      reason: 'Attempt to revoke again'
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 409);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'DELEGATION_ALREADY_REVOKED');
  });

  it('Group 5.3: returns 403 when non-delegator tries to revoke', async () => {
    // Create delegation owned by delegator
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address
    );
    
    // Try to revoke with attacker's private key
    const request: DelegationRevokeRequest = {
      delegatorPrivKey: TEST_WALLETS.attacker.privateKey, // Wrong signer!
      reason: 'Unauthorized revocation attempt'
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 403);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'UNAUTHORIZED_REVOCATION');
  });

  it('Group 5.4: returns 404 for non-existent delegation', async () => {
    const nonExistentDelegationId = '00000000-0000-0000-0000-000000000000';
    
    const request: DelegationRevokeRequest = {
      delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
      reason: 'Attempt to revoke non-existent delegation'
    };
    
    const response = await fetch(`${BRIDGE_URL}/delegation/${nonExistentDelegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    // THIS SHOULD FAIL - endpoint not implemented correctly yet
    assert.strictEqual(response.status, 404);
    
    const errorResponse: BridgeErrorResponse = await response.json();
    assert.strictEqual(errorResponse.error, 'DELEGATION_NOT_FOUND');
  });
});

// ============================================================================
// Integration Tests - Cross-Endpoint Behavior
// ============================================================================

describe('Integration: Delegation Lifecycle', () => {

  it('full delegation lifecycle: create → use → revoke → reject', async () => {
    // 1. Create delegation
    const delegationId = await createTestDelegation(
      TEST_WALLETS.delegator.privateKey,
      TEST_WALLETS.relayer.address,
      ['TRANSITION_STATE_MACHINE'],
      1000000,
      999999
    );
    
    // 2. Create state machine owned by delegator
    const createSMResponse = await fetch(`${BRIDGE_URL}/sm/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: TEST_WALLETS.delegator.privateKey,
        definition: {
          initialState: { value: 'ACTIVE' },
          states: {
            ACTIVE: {
              stateId: { value: 'ACTIVE' },
              transitions: [{
                from: { value: 'ACTIVE' },
                to: { value: 'COMPLETED' },
                eventName: 'complete',
                guards: [],
                effects: []
              }]
            },
            COMPLETED: {
              stateId: { value: 'COMPLETED' },
              transitions: []
            }
          }
        },
        stateData: {},
        owners: [TEST_WALLETS.delegator.address]
      })
    });
    
    assert.ok(createSMResponse.ok);
    const createResult = await createSMResponse.json();
    
    // 3. Successfully use delegation to transition state machine
    const delegatedSubmit = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegationId,
        messageType: 'TRANSITION_STATE_MACHINE',
        messagePayload: {
          fiberId: createResult.fiberId,
          event: {
            eventName: 'complete',
            payload: {}
          }
        },
        sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
      })
    });
    
    // THIS SHOULD FAIL - endpoints not implemented yet
    assert.strictEqual(delegatedSubmit.status, 200);
    
    // 4. Revoke the delegation
    const revokeResponse = await fetch(`${BRIDGE_URL}/delegation/${delegationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegatorPrivKey: TEST_WALLETS.delegator.privateKey,
        reason: 'Integration test completion'
      })
    });
    
    assert.strictEqual(revokeResponse.status, 200);
    
    // 5. Attempt to use revoked delegation (should fail)
    const failedSubmit = await fetch(`${BRIDGE_URL}/delegation/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegationId,
        messageType: 'TRANSITION_STATE_MACHINE',
        messagePayload: {
          fiberId: createResult.fiberId,
          event: {
            eventName: 'complete', // Try to transition again
            payload: {}
          }
        },
        sessionKeyPrivKey: TEST_WALLETS.relayer.privateKey
      })
    });
    
    assert.strictEqual(failedSubmit.status, 409);
    const errorResponse = await failedSubmit.json();
    assert.strictEqual(errorResponse.error, 'DELEGATION_REVOKED');
  });
});