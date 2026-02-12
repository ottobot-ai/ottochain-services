/**
 * Delegation Routes Integration Tests
 * 
 * Tests delegation functionality without requiring full metagraph cluster
 * Focus on API endpoints, validation, and delegation lifecycle
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { delegateRoutes } from '../dist/routes/delegate.js';

const TEST_PORT = 3031;
const BRIDGE_URL = `http://localhost:${TEST_PORT}`;

// Test wallets (static for consistency)
const delegatorWallet = {
  privateKey: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
  address: 'DAG5zbcd3BkcqV9zis1Knw5nS93zUdY2VLwpTPhQ',
};

const relayerWallet = {
  privateKey: 'b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567a',
  address: 'DAG7UekJjZKUH5qREz9P8ECwXSEjNv5a8v3UfDr5',
};

let testServer: any;

before(async () => {
  // Start a test server with delegation routes
  const app = express();
  app.use(express.json());
  app.use('/delegate', delegateRoutes);
  
  testServer = app.listen(TEST_PORT, () => {
    console.log(`Test server running on port ${TEST_PORT}`);
  });
  
  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 100));
});

after(async () => {
  if (testServer) {
    testServer.close();
  }
});

// Helper function to make HTTP requests
async function request(
  method: string,
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
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
  let data;
  
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  
  return { status: response.status, data };
}

describe('Delegation API', () => {
  
  describe('Health Check', () => {
    it('should return delegation service health status', async () => {
      const { status, data } = await request('GET', '/delegate/health');
      
      assert.strictEqual(status, 200);
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.service, 'delegation');
      assert.ok('stats' in data);
    });
  });
  
  describe('Create Delegation', () => {
    it('should create a new delegation with valid parameters', async () => {
      const { status, data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine', 'TransitionStateMachine'],
        expiresIn: 3600, // 1 hour
      });
      
      assert.strictEqual(status, 200);
      assert.ok('delegationId' in data);
      assert.ok('delegation' in data);
      
      const { delegation } = data;
      assert.strictEqual(delegation.delegator, delegatorWallet.address);
      assert.strictEqual(delegation.delegatee, relayerWallet.address);
      assert.deepStrictEqual(delegation.scope, ['CreateStateMachine', 'TransitionStateMachine']);
      assert.strictEqual(delegation.status, 'active');
      assert.ok(delegation.expiresAt > Date.now());
    });
    
    it('should reject invalid private key', async () => {
      const { status, data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: 'invalid',
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine'],
        expiresIn: 3600,
      });
      
      assert.strictEqual(status, 400);
      assert.ok('error' in data);
    });
    
    it('should reject missing required fields', async () => {
      const { status, data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        // Missing delegateeAddress
        scope: ['CreateStateMachine'],
        expiresIn: 3600,
      });
      
      assert.strictEqual(status, 400);
      assert.ok('error' in data);
      assert.ok('details' in data);
    });
  });
  
  describe('Delegation Status', () => {
    let delegationId: string;
    
    before(async () => {
      // Create a delegation for status testing
      const { data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['TransitionStateMachine'],
        expiresIn: 1800, // 30 minutes
      });
      delegationId = data.delegationId;
    });
    
    it('should return delegation status for valid ID', async () => {
      const { status, data } = await request('GET', `/delegate/status/${delegationId}`);
      
      assert.strictEqual(status, 200);
      assert.ok('delegation' in data);
      
      const { delegation } = data;
      assert.strictEqual(delegation.id, delegationId);
      assert.strictEqual(delegation.status, 'active');
      assert.strictEqual(delegation.delegator, delegatorWallet.address);
      assert.strictEqual(delegation.delegatee, relayerWallet.address);
    });
    
    it('should return 404 for non-existent delegation', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174000';
      const { status, data } = await request('GET', `/delegate/status/${fakeId}`);
      
      assert.strictEqual(status, 404);
      assert.ok('error' in data);
    });
  });
  
  describe('Active Delegations', () => {
    let delegationId1: string;
    let delegationId2: string;
    
    before(async () => {
      // Create multiple delegations for testing
      const result1 = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine'],
        expiresIn: 7200, // 2 hours
      });
      delegationId1 = result1.data.delegationId;
      
      const result2 = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: 'DAGAnotherRelayer789',
        scope: ['TransitionStateMachine'],
        expiresIn: 3600, // 1 hour
      });
      delegationId2 = result2.data.delegationId;
    });
    
    it('should return active delegations by delegator', async () => {
      const { status, data } = await request(
        'GET',
        `/delegate/active?delegator=${delegatorWallet.address}`
      );
      
      assert.strictEqual(status, 200);
      assert.ok('delegations' in data);
      assert.ok(Array.isArray(data.delegations));
      assert.ok(data.delegations.length >= 2);
      
      // Check that our delegations are in the results
      const delegationIds = data.delegations.map((d: any) => d.id);
      assert.ok(delegationIds.includes(delegationId1));
      assert.ok(delegationIds.includes(delegationId2));
    });
    
    it('should return active delegations by delegatee', async () => {
      const { status, data } = await request(
        'GET',
        `/delegate/active?delegatee=${relayerWallet.address}`
      );
      
      assert.strictEqual(status, 200);
      assert.ok('delegations' in data);
      assert.ok(Array.isArray(data.delegations));
      
      // Should find at least one delegation for this relayer
      const delegationIds = data.delegations.map((d: any) => d.id);
      assert.ok(delegationIds.includes(delegationId1));
    });
    
    it('should require delegator or delegatee parameter', async () => {
      const { status, data } = await request('GET', '/delegate/active');
      
      assert.strictEqual(status, 400);
      assert.ok('error' in data);
    });
  });
  
  describe('Revoke Delegation', () => {
    let delegationId: string;
    
    before(async () => {
      // Create a delegation for revocation testing
      const { data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine'],
        expiresIn: 3600,
      });
      delegationId = data.delegationId;
    });
    
    it('should revoke delegation with valid delegator key', async () => {
      const { status, data } = await request('DELETE', `/delegate/revoke/${delegationId}`, {
        delegatorPrivateKey: delegatorWallet.privateKey,
      });
      
      assert.strictEqual(status, 200);
      assert.strictEqual(data.success, true);
      
      // Verify delegation is revoked
      const statusResult = await request('GET', `/delegate/status/${delegationId}`);
      assert.strictEqual(statusResult.data.delegation.status, 'revoked');
    });
    
    it('should reject revocation with wrong private key', async () => {
      const { data: createData } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine'],
        expiresIn: 3600,
      });
      
      const { status, data } = await request('DELETE', `/delegate/revoke/${createData.delegationId}`, {
        delegatorPrivateKey: relayerWallet.privateKey, // Wrong key
      });
      
      assert.strictEqual(status, 403);
      assert.ok('error' in data);
    });
    
    it('should return 404 for non-existent delegation', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174000';
      const { status, data } = await request('DELETE', `/delegate/revoke/${fakeId}`, {
        delegatorPrivateKey: delegatorWallet.privateKey,
      });
      
      assert.strictEqual(status, 404);
      assert.ok('error' in data);
    });
  });
  
  describe('Submit Delegated Transaction', () => {
    let activeDelegationId: string;
    
    before(async () => {
      // Create an active delegation for transaction testing
      const { data } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine', 'TransitionStateMachine'],
        expiresIn: 3600,
      });
      activeDelegationId = data.delegationId;
    });
    
    it('should reject transaction submission (no metagraph running)', async () => {
      // This test verifies the validation logic without requiring a full metagraph
      const testTransaction = {
        CreateStateMachine: {
          fiberId: 'test-fiber-123',
          definition: { /* minimal definition */ },
        },
      };
      
      const { status, data } = await request('POST', '/delegate/submit', {
        transaction: testTransaction,
        delegationId: activeDelegationId,
        relayerPrivateKey: relayerWallet.privateKey,
      });
      
      // Should fail at metagraph submission, not validation
      assert.strictEqual(status, 500);
      assert.ok('error' in data);
      assert.ok(data.error.includes('submission failed'));
    });
    
    it('should reject with invalid delegation ID', async () => {
      const testTransaction = { CreateStateMachine: {} };
      const fakeId = '123e4567-e89b-12d3-a456-426614174000';
      
      const { status, data } = await request('POST', '/delegate/submit', {
        transaction: testTransaction,
        delegationId: fakeId,
        relayerPrivateKey: relayerWallet.privateKey,
      });
      
      assert.strictEqual(status, 404);
      assert.ok('error' in data);
    });
    
    it('should reject with wrong relayer key', async () => {
      const testTransaction = { CreateStateMachine: {} };
      
      const { status, data } = await request('POST', '/delegate/submit', {
        transaction: testTransaction,
        delegationId: activeDelegationId,
        relayerPrivateKey: delegatorWallet.privateKey, // Wrong key
      });
      
      assert.strictEqual(status, 403);
      assert.ok('error' in data);
      assert.ok(data.error.includes('not authorized'));
    });
  });
  
  describe('Expiration Handling', () => {
    it('should auto-expire delegations past their expiration time', async () => {
      // Create a delegation that expires quickly
      const { data: createData } = await request('POST', '/delegate/create', {
        delegatorPrivateKey: delegatorWallet.privateKey,
        delegateeAddress: relayerWallet.address,
        scope: ['CreateStateMachine'],
        expiresIn: 1, // 1 second
      });
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Check status - should be expired
      const { data: statusData } = await request('GET', `/delegate/status/${createData.delegationId}`);
      assert.strictEqual(statusData.delegation.status, 'expired');
      
      // Try to use expired delegation
      const { status } = await request('POST', '/delegate/submit', {
        transaction: { CreateStateMachine: {} },
        delegationId: createData.delegationId,
        relayerPrivateKey: relayerWallet.privateKey,
      });
      
      assert.strictEqual(status, 400);
    });
  });
});