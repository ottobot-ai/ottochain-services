/**
 * Bridge E2E Tests
 * 
 * Tests the full flow: Bridge → DL1 → ML0 → verification
 * Requires running OttoChain cluster (gl0, ml0, dl1)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL || 'http://localhost:9200';

interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface RegisterResult {
  fiberId: string;
  address: string;
  hash: string;
  message: string;
}

interface StateMachine {
  fiberId: string;
  currentState: { value: string };
  stateData: Record<string, unknown>;
  owners: string[];
  sequenceNumber: number;
  status: string;
}

// Helper to wait for state machine to appear on ML0
async function waitForFiber(fiberId: string, timeoutMs = 30000): Promise<StateMachine | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.fiberId) {
          return data as StateMachine;
        }
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return null;
}

// Helper to wait for state transition
async function waitForState(fiberId: string, expectedState: string, timeoutMs = 30000): Promise<StateMachine | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (response.ok) {
        const data = await response.json() as StateMachine;
        if (data?.currentState?.value === expectedState) {
          return data;
        }
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return null;
}

describe('Bridge E2E Tests', () => {
  let wallet1: Wallet;
  let wallet2: Wallet;
  let agent1FiberId: string;
  let agent2FiberId: string;

  before(async () => {
    // Check bridge is running
    const healthResponse = await fetch(`${BRIDGE_URL}/health`);
    assert.ok(healthResponse.ok, 'Bridge should be healthy');
    
    // Check ML0 is running
    const ml0Response = await fetch(`${ML0_URL}/node/info`);
    assert.ok(ml0Response.ok, 'ML0 should be running');
  });

  describe('Wallet Generation', () => {
    it('should generate a valid wallet', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/wallet`, { method: 'POST' });
      assert.strictEqual(response.status, 200);
      
      wallet1 = await response.json() as Wallet;
      
      assert.ok(wallet1.privateKey, 'Should have privateKey');
      assert.ok(wallet1.publicKey, 'Should have publicKey');
      assert.ok(wallet1.address, 'Should have address');
      assert.strictEqual(wallet1.privateKey.length, 64, 'Private key should be 64 hex chars');
      assert.ok(wallet1.address.startsWith('DAG'), 'Address should start with DAG');
      
      console.log(`  ✓ Generated wallet: ${wallet1.address}`);
    });

    it('should generate unique wallets', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/wallet`, { method: 'POST' });
      wallet2 = await response.json() as Wallet;
      
      assert.notStrictEqual(wallet1.address, wallet2.address, 'Wallets should be unique');
      console.log(`  ✓ Generated second wallet: ${wallet2.address}`);
    });
  });

  describe('Agent Registration', () => {
    it('should register an agent on-chain', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: wallet1.privateKey,
          displayName: 'E2E Test Agent 1',
          platform: 'e2e-test',
          platformUserId: 'test-agent-1',
        }),
      });
      
      assert.strictEqual(response.status, 201, 'Should return 201 Created');
      
      const result = await response.json() as RegisterResult;
      assert.ok(result.fiberId, 'Should have fiberId');
      assert.ok(result.hash, 'Should have transaction hash');
      assert.strictEqual(result.address, wallet1.address, 'Should match wallet address');
      
      agent1FiberId = result.fiberId;
      console.log(`  ✓ Registered agent: ${result.fiberId}`);
    });

    it('should appear on ML0 within 30s', async () => {
      const fiber = await waitForFiber(agent1FiberId);
      
      assert.ok(fiber, 'Fiber should appear on ML0');
      assert.strictEqual(fiber.currentState.value, 'REGISTERED', 'Should be in Registered state');
      assert.strictEqual(fiber.owners[0], wallet1.address, 'Should be owned by registrant');
      assert.strictEqual(fiber.stateData.displayName, 'E2E Test Agent 1', 'Should have correct displayName');
      assert.strictEqual(fiber.stateData.reputation, 10, 'Should have initial reputation of 10');
      
      console.log(`  ✓ Fiber confirmed on ML0: state=${fiber.currentState.value}, reputation=${fiber.stateData.reputation}`);
    });

    it('should register a second agent', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: wallet2.privateKey,
          displayName: 'E2E Test Agent 2',
          platform: 'e2e-test',
          platformUserId: 'test-agent-2',
        }),
      });
      
      assert.strictEqual(response.status, 201);
      const result = await response.json() as RegisterResult;
      agent2FiberId = result.fiberId;
      
      // Wait for confirmation
      const fiber = await waitForFiber(agent2FiberId);
      assert.ok(fiber, 'Second agent should appear on ML0');
      
      console.log(`  ✓ Registered second agent: ${agent2FiberId}`);
    });
  });

  describe('Agent Activation', () => {
    it('should activate an agent', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: wallet1.privateKey,
          fiberId: agent1FiberId,
        }),
      });
      
      assert.strictEqual(response.status, 200, 'Should return 200 OK');
      
      const result = await response.json() as { hash: string; fiberId: string; status: string };
      assert.ok(result.hash, 'Should have transaction hash');
      
      console.log(`  ✓ Activation submitted: ${result.hash}`);
    });

    it('should transition to Active state on ML0', async () => {
      const fiber = await waitForState(agent1FiberId, 'ACTIVE');
      
      assert.ok(fiber, 'Fiber should transition to Active');
      assert.strictEqual(fiber.currentState.value, 'ACTIVE', 'State should be Active');
      assert.strictEqual(fiber.sequenceNumber, 1, 'Sequence number should be 1 after activation');
      
      console.log(`  ✓ Agent activated: state=${fiber.currentState.value}, seq=${fiber.sequenceNumber}`);
    });
  });

  describe('Agent Query', () => {
    it('should query agent by fiberId', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/${agent1FiberId}`);
      assert.strictEqual(response.status, 200);
      
      const agent = await response.json() as StateMachine;
      assert.strictEqual(agent.fiberId, agent1FiberId);
      assert.strictEqual(agent.currentState.value, 'ACTIVE');
      
      console.log(`  ✓ Queried agent: ${agent.fiberId}`);
    });

    it('should list all agents', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json() as { count: number; agents: Record<string, unknown> };
      assert.ok(result.count >= 2, 'Should have at least 2 agents');
      
      console.log(`  ✓ Listed ${result.count} agents`);
    });
  });

  describe('Validation', () => {
    it('should reject invalid private key', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: 'invalid-key',
          displayName: 'Bad Agent',
        }),
      });
      
      assert.strictEqual(response.status, 400, 'Should return 400 for invalid key');
      console.log(`  ✓ Rejected invalid private key`);
    });

    it('should reject activation of non-existent agent', async () => {
      const response = await fetch(`${BRIDGE_URL}/agent/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: wallet1.privateKey,
          fiberId: '00000000-0000-0000-0000-000000000000',
        }),
      });
      
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent agent');
      console.log(`  ✓ Rejected activation of non-existent agent`);
    });
  });
});

// Run if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('\n🧪 Running Bridge E2E Tests\n');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ML0: ${ML0_URL}\n`);
}
