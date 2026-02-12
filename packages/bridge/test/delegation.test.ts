/**
 * Delegation Bridge API Tests
 * 
 * Tests the delegation routes: create, get, list, revoke, and submit
 * Requires running bridge service for integration testing
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';

// Test wallet for delegation operations
const TEST_WALLET = {
  privateKey: 'a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6',
  address: 'DAG88FaLnWE2CqhMr6SpNMtyrs9GBBAiXs25yToyM4',
};

const TEST_DELEGATE = {
  privateKey: 'b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6',
  address: 'DAG77EbKmXD3CphLq5ToMLgtr8sFAABhYt24xToxN3',
};

interface DelegationCreateRequest {
  delegateAddress: string;
  scope: {
    allowedOperations?: string[];
    fiberIds?: string[];
    maxGasPerTx?: number;
    maxTotalGas?: number;
    policyRules?: Record<string, unknown>;
  };
  approach: number; // DelegationApproach enum value
  expiresAt: string;
  metadata?: Record<string, unknown>;
  privateKey: string;
}

interface DelegationResponse {
  delegationId: string;
  delegation: {
    delegationId: string;
    principalAddress: string;
    delegateAddress: string;
    approach: number;
    scope: {
      allowedOperations: string[];
    };
  };
  message: string;
}

async function httpRequest(method: string, path: string, body?: any): Promise<any> {
  const url = `${BRIDGE_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }

  return {
    status: response.status,
    data,
    ok: response.ok,
  };
}

describe('Delegation Bridge Routes', () => {
  const validDelegationRequest: DelegationCreateRequest = {
    delegateAddress: TEST_DELEGATE.address,
    scope: {
      allowedOperations: ['CreateFiber', 'TransitionFiber'],
      maxGasPerTx: 1000,
      maxTotalGas: 10000,
    },
    approach: 1, // DELEGATION_APPROACH_SESSION_KEY
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    metadata: { purpose: 'test-delegation' },
    privateKey: TEST_WALLET.privateKey,
  };

  let testDelegationId: string;

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await httpRequest('GET', '/delegation/health');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.status, 'ok');
      assert.strictEqual(response.data.service, 'delegation-bridge');
      assert.strictEqual(typeof response.data.activeDelegations, 'number');
      assert.strictEqual(typeof response.data.revokedDelegations, 'number');
    });
  });

  describe('Create Delegation', () => {
    it('should create a delegation successfully', async () => {
      const response = await httpRequest('POST', '/delegation/create', validDelegationRequest);

      console.log('Create delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 200);
      assert.ok(response.data.delegationId);
      assert.strictEqual(response.data.delegation.delegateAddress, TEST_DELEGATE.address);
      assert.deepStrictEqual(
        response.data.delegation.scope.allowedOperations,
        ['CreateFiber', 'TransitionFiber']
      );
      assert.strictEqual(response.data.message, 'Delegation created successfully');

      // Store for later tests
      testDelegationId = response.data.delegationId;
    });

    it('should reject delegation with missing delegate address', async () => {
      const invalidRequest = { ...validDelegationRequest };
      const { delegateAddress, ...requestWithoutDelegate } = invalidRequest;

      const response = await httpRequest('POST', '/delegation/create', requestWithoutDelegate);

      console.log('Invalid delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 400);
    });

    it('should reject delegation with past expiry', async () => {
      const expiredRequest = {
        ...validDelegationRequest,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      };

      const response = await httpRequest('POST', '/delegation/create', expiredRequest);

      console.log('Expired delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.data.error, 'Invalid delegation');
    });
  });

  describe('Get Delegation', () => {
    it('should retrieve delegation by ID', async () => {
      // Ensure we have a delegation to test with
      if (!testDelegationId) {
        const createResponse = await httpRequest('POST', '/delegation/create', validDelegationRequest);
        testDelegationId = createResponse.data.delegationId;
      }

      const response = await httpRequest('GET', `/delegation/${testDelegationId}`);

      console.log('Get delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.delegation.delegationId, testDelegationId);
      assert.ok(response.data.usage);
      assert.strictEqual(response.data.usage.transactionCount, 0);
      assert.strictEqual(response.data.isRevoked, false);
      assert.strictEqual(response.data.status, 'active');
    });

    it('should return 404 for non-existent delegation', async () => {
      const response = await httpRequest('GET', '/delegation/non-existent-id');

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.data.error, 'Delegation not found');
    });
  });

  describe('List Delegations', () => {
    it('should list all delegations', async () => {
      const response = await httpRequest('GET', '/delegation');

      console.log('List delegations response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.data.delegations));
      assert.strictEqual(typeof response.data.total, 'number');

      if (response.data.delegations.length > 0) {
        const delegation = response.data.delegations[0];
        assert.ok(delegation.delegationId);
        assert.ok(delegation.principalAddress);
        assert.ok(delegation.delegateAddress);
      }
    });

    it('should filter by status', async () => {
      const response = await httpRequest('GET', '/delegation?status=active');

      console.log('Filtered delegations response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.data.delegations));

      // All returned delegations should be active
      for (const delegation of response.data.delegations) {
        assert.notStrictEqual(delegation.isRevoked, true);
        const notExpired = new Date(delegation.expiresAt) > new Date();
        assert.ok(notExpired);
      }
    });
  });

  describe('Submit Delegated Transaction', () => {
    it('should reject transaction for non-existent delegation', async () => {
      const relayedTxRequest = {
        transaction: {
          type: 'CreateFiber',
          fiberId: 'test-fiber-123',
          data: { test: 'data' },
        },
        delegationId: 'non-existent-id',
        delegationProof: {
          type: 'sessionKey',
          proof: { sessionKey: 'mock-session-key' },
        },
        gasConfig: {
          gasLimit: 500,
          paymentMethod: 1, // FEE_PAYMENT_METHOD_RELAYER_PAYS
        },
        relayerPrivateKey: TEST_DELEGATE.privateKey,
      };

      const response = await httpRequest('POST', '/delegation/submit', relayedTxRequest);

      console.log('Submit non-existent delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.data.error, 'Delegation not found');
    });

    // Note: Full delegation submission test would require a running OttoChain cluster
    // This is more of an integration test that should be run with the full system
  });

  describe('Revoke Delegation', () => {
    it('should revoke delegation successfully', async () => {
      // Ensure we have a delegation to revoke
      if (!testDelegationId) {
        const createResponse = await httpRequest('POST', '/delegation/create', validDelegationRequest);
        testDelegationId = createResponse.data.delegationId;
      }

      const revokeRequest = {
        reason: 'Test revocation',
        privateKey: TEST_WALLET.privateKey,
      };

      const response = await httpRequest('DELETE', `/delegation/${testDelegationId}`, revokeRequest);

      console.log('Revoke delegation response:', JSON.stringify(response, null, 2));

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.delegationId, testDelegationId);
      assert.strictEqual(response.data.message, 'Delegation revoked successfully');

      // Verify the delegation is marked as revoked
      const getResponse = await httpRequest('GET', `/delegation/${testDelegationId}`);
      assert.strictEqual(getResponse.data.isRevoked, true);
    });

    it('should reject revocation of non-existent delegation', async () => {
      const revokeRequest = {
        reason: 'Test revocation',
        privateKey: TEST_WALLET.privateKey,
      };

      const response = await httpRequest('DELETE', '/delegation/non-existent-id', revokeRequest);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.data.error, 'Delegation not found');
    });

    it('should reject double revocation', async () => {
      // Create a new delegation to test double revocation
      const createResponse = await httpRequest('POST', '/delegation/create', validDelegationRequest);
      const delegationId = createResponse.data.delegationId;

      const revokeRequest = {
        reason: 'First revocation',
        privateKey: TEST_WALLET.privateKey,
      };

      // First revocation should succeed
      const firstRevokeResponse = await httpRequest('DELETE', `/delegation/${delegationId}`, revokeRequest);
      assert.strictEqual(firstRevokeResponse.status, 200);

      // Second revocation should fail
      const secondRevokeResponse = await httpRequest('DELETE', `/delegation/${delegationId}`, {
        ...revokeRequest,
        reason: 'Second revocation',
      });

      console.log('Double revocation response:', JSON.stringify(secondRevokeResponse, null, 2));

      assert.strictEqual(secondRevokeResponse.status, 409);
      assert.strictEqual(secondRevokeResponse.data.error, 'Delegation already revoked');
    });
  });
});