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
        const data = await response.json() as any;
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

  describe('Market Lifecycle', () => {
    let marketWallet: Wallet;
    let participantWallet: Wallet;
    let oracleWallet: Wallet;
    let marketId: string;

    before(async () => {
      // Generate fresh wallets for market tests
      const [mw, pw, ow] = await Promise.all([
        fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' }).then(r => r.json()),
        fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' }).then(r => r.json()),
        fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' }).then(r => r.json()),
      ]);
      marketWallet = mw as Wallet;
      participantWallet = pw as Wallet;
      oracleWallet = ow as Wallet;
      console.log(`  ✓ Generated market wallets`);
    });

    it('should create a prediction market with ISO deadline', async () => {
      // Use ISO deadline string - bridge should convert to epoch ms
      const deadline = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      
      const response = await fetch(`${BRIDGE_URL}/market/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: marketWallet.privateKey,
          marketType: 'prediction',
          title: 'E2E Test Market - Deadline Handling',
          description: 'Tests that ISO deadline is converted to epoch for JSON Logic',
          deadline,
          threshold: 10,
          quorum: 1,
          oracles: [oracleWallet.address],
          terms: {
            question: 'Will this test pass?',
            outcomes: ['YES', 'NO'],
            feePercent: 0.02,
          },
        }),
      });

      assert.strictEqual(response.status, 201, 'Should return 201 Created');
      const result = await response.json() as { marketId: string; hash: string };
      assert.ok(result.marketId, 'Should have marketId');
      marketId = result.marketId;
      
      console.log(`  ✓ Created market: ${marketId}`);
    });

    it('should appear on ML0 with epoch deadline', async () => {
      const fiber = await waitForFiber(marketId);
      assert.ok(fiber, 'Market should appear on ML0');
      assert.strictEqual(fiber.currentState.value, 'PROPOSED', 'Should be PROPOSED');
      
      // Verify deadline is stored as number (epoch ms), not string
      const deadline = fiber.stateData.deadline as number;
      assert.strictEqual(typeof deadline, 'number', 'Deadline should be epoch ms (number)');
      assert.ok(deadline > Date.now(), 'Deadline should be in the future');
      
      console.log(`  ✓ Market on ML0, deadline=${deadline} (epoch ms)`);
    });

    it('should open the market', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: marketWallet.privateKey,
          marketId,
        }),
      });

      assert.strictEqual(response.status, 200);
      const result = await response.json() as { status: string };
      assert.strictEqual(result.status, 'OPEN');
      
      console.log(`  ✓ Market opened`);
    });

    it('should transition to OPEN on ML0', async () => {
      const fiber = await waitForState(marketId, 'OPEN');
      assert.ok(fiber, 'Market should transition to OPEN');
      
      console.log(`  ✓ Market state: ${fiber.currentState.value}`);
    });

    it('should accept a commitment', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participantWallet.privateKey,
          marketId,
          amount: 100,
          data: { side: 'YES' },
        }),
      });

      assert.strictEqual(response.status, 200);
      const result = await response.json() as { hash: string; amount: number };
      assert.strictEqual(result.amount, 100);
      
      console.log(`  ✓ Committed 100 on YES`);
    });

    it('should reflect commitment on ML0', async () => {
      // Wait a bit for state to sync
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const response = await fetch(`${BRIDGE_URL}/market/${marketId}`);
      const market = await response.json() as StateMachine;
      
      assert.strictEqual(market.stateData.totalCommitted, 100, 'Total should be 100');
      
      console.log(`  ✓ Commitment reflected: totalCommitted=${market.stateData.totalCommitted}`);
    });

    it('should close the market', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: marketWallet.privateKey,
          marketId,
        }),
      });

      assert.strictEqual(response.status, 200);
      const result = await response.json() as { status: string };
      assert.strictEqual(result.status, 'CLOSED');
      
      console.log(`  ✓ Market closed`);
    });

    it('should transition to CLOSED on ML0', async () => {
      const fiber = await waitForState(marketId, 'CLOSED');
      assert.ok(fiber, 'Market should transition to CLOSED');
      
      console.log(`  ✓ Market state: ${fiber.currentState.value}`);
    });

    it('should accept oracle resolution', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: oracleWallet.privateKey,
          marketId,
          outcome: 'YES',
          proof: 'E2E test confirmed passing',
        }),
      });

      assert.strictEqual(response.status, 200);
      const result = await response.json() as { outcome: string };
      assert.strictEqual(result.outcome, 'YES');
      
      console.log(`  ✓ Oracle resolved: YES`);
    });

    it('should transition to RESOLVING on ML0', async () => {
      const fiber = await waitForState(marketId, 'RESOLVING');
      assert.ok(fiber, 'Market should transition to RESOLVING');
      
      const resolutions = fiber.stateData.resolutions as Array<{ outcome: string }>;
      assert.ok(resolutions.length >= 1, 'Should have at least 1 resolution');
      
      console.log(`  ✓ Market resolving: ${resolutions.length} resolution(s)`);
    });

    it('should finalize the market', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: marketWallet.privateKey,
          marketId,
          outcome: 'YES',
        }),
      });

      assert.strictEqual(response.status, 200);
      const result = await response.json() as { status: string };
      assert.strictEqual(result.status, 'SETTLED');
      
      console.log(`  ✓ Market finalized`);
    });

    it('should transition to SETTLED on ML0', async () => {
      const fiber = await waitForState(marketId, 'SETTLED');
      assert.ok(fiber, 'Market should transition to SETTLED');
      assert.strictEqual(fiber.stateData.finalOutcome, 'YES', 'Final outcome should be YES');
      
      console.log(`  ✓ Market settled: outcome=${fiber.stateData.finalOutcome}`);
    });

    it('should allow winner to claim', async () => {
      const response = await fetch(`${BRIDGE_URL}/market/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participantWallet.privateKey,
          marketId,
        }),
      });

      assert.strictEqual(response.status, 200);
      
      console.log(`  ✓ Winner claimed`);
    });

    it('should record claim on ML0', async () => {
      // Wait for claim to propagate
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const response = await fetch(`${BRIDGE_URL}/market/${marketId}`);
      const market = await response.json() as StateMachine;
      
      const claims = market.stateData.claims as Record<string, unknown> | Array<{ agent: string }>;
      const claimCount = Array.isArray(claims) ? claims.length : Object.keys(claims).length;
      assert.ok(claimCount >= 1, 'Should have at least 1 claim');
      
      console.log(`  ✓ Claim recorded: ${claimCount} claim(s)`);
    });
  });
});

// Run if executed directly
if (require.main === module) {
  console.log('\n🧪 Running Bridge E2E Tests\n');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ML0: ${ML0_URL}\n`);
}
