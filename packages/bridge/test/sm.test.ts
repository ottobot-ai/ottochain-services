/**
 * State Machine E2E Tests
 * 
 * Tests the generic state machine routes with the Market definition.
 * Requires running OttoChain cluster (gl0, ml0, dl1) and bridge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';


const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL || 'http://localhost:9200';

// ============================================================================
// Types
// ============================================================================

interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface CreateSMResult {
  fiberId: string;
  creator: string;
  schema: string;
  hash: string;
}

interface TransitionResult {
  fiberId: string;
  eventName: string;
  previousState: string;
  hash: string;
}

interface CommitResult {
  fiberId: string;
  agent: string;
  amount: number;
  hash: string;
}

interface StateMachine {
  fiberId: string;
  currentState: string;
  stateData: Record<string, unknown>;
  owners: string[];
  sequenceNumber: number;
  definition: {
    metadata: { name: string; version?: string };
    states: Record<string, unknown>;
    initialState: string;
    transitions: unknown[];
  };
}

interface ListResult {
  total: number;
  offset: number;
  limit: number;
  count: number;
  stateMachines: Record<string, StateMachine>;
}

// ============================================================================
// Market State Machine Definition
// ============================================================================

const MarketDefinition = {
  metadata: {
    name: 'Market',
    description: 'Universal market state machine: predictions, auctions, crowdfunding, group buys',
    version: '1.0.0',
  },
  states: {
    PROPOSED: { id: 'PROPOSED', isFinal: false },
    OPEN: { id: 'OPEN', isFinal: false },
    CLOSED: { id: 'CLOSED', isFinal: false },
    RESOLVING: { id: 'RESOLVING', isFinal: false },
    SETTLED: { id: 'SETTLED', isFinal: true },
    REFUNDED: { id: 'REFUNDED', isFinal: true },
    CANCELLED: { id: 'CANCELLED', isFinal: true },
  },
  initialState: 'PROPOSED',
  transitions: [
    {
      from: 'PROPOSED',
      to: 'OPEN',
      eventName: 'open',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] },
      effect: {
        merge: [
          { var: 'state' },
          { status: 'OPEN', openedAt: { var: '$timestamp' } },
        ],
      },
    },
    {
      from: 'PROPOSED',
      to: 'CANCELLED',
      eventName: 'cancel',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] },
      effect: {
        merge: [
          { var: 'state' },
          { status: 'CANCELLED', cancelledAt: { var: '$timestamp' }, reason: { var: 'event.reason' } },
        ],
      },
    },
    {
      from: 'OPEN',
      to: 'OPEN',
      eventName: 'commit',
      guard: {
        and: [
          { '>': [{ var: 'event.amount' }, 0] },
          {
            or: [
              { '!': { var: 'state.deadline' } },
              { '<=': [{ var: '$timestamp' }, { var: 'state.deadline' }] },
            ],
          },
        ],
      },
      effect: {
        merge: [
          { var: 'state' },
          {
            commitments: {
              setKey: [
                { var: 'state.commitments' },
                { var: 'event.agent' },
                {
                  merge: [
                    { getKey: [{ var: 'state.commitments' }, { var: 'event.agent' }, { amount: 0, data: {} }] },
                    {
                      amount: {
                        '+': [
                          { getKey: [{ getKey: [{ var: 'state.commitments' }, { var: 'event.agent' }, { amount: 0 }] }, 'amount', 0] },
                          { var: 'event.amount' },
                        ],
                      },
                      data: { var: 'event.data' },
                      lastCommitAt: { var: '$timestamp' },
                    },
                  ],
                },
              ],
            },
            totalCommitted: { '+': [{ var: 'state.totalCommitted' }, { var: 'event.amount' }] },
          },
        ],
      },
    },
    {
      from: 'OPEN',
      to: 'CLOSED',
      eventName: 'close',
      guard: {
        or: [
          { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] },
          {
            and: [
              { var: 'state.deadline' },
              { '>=': [{ var: '$timestamp' }, { var: 'state.deadline' }] },
            ],
          },
        ],
      },
      effect: {
        merge: [
          { var: 'state' },
          { status: 'CLOSED', closedAt: { var: '$timestamp' } },
        ],
      },
    },
    {
      from: 'CLOSED',
      to: 'RESOLVING',
      eventName: 'submit_resolution',
      guard: {
        or: [
          { in: [{ var: 'event.agent' }, { var: 'state.oracles' }] },
          { '===': [{ var: 'event.agent' }, { var: 'state.creator' }] },
        ],
      },
      effect: {
        merge: [
          { var: 'state' },
          {
            status: 'RESOLVING',
            resolutions: {
              cat: [
                { var: 'state.resolutions' },
                [
                  {
                    oracle: { var: 'event.agent' },
                    outcome: { var: 'event.outcome' },
                    proof: { var: 'event.proof' },
                    submittedAt: { var: '$timestamp' },
                  },
                ],
              ],
            },
          },
        ],
      },
    },
    {
      from: 'RESOLVING',
      to: 'SETTLED',
      eventName: 'finalize',
      guard: {
        or: [
          { '>=': [{ size: { var: 'state.resolutions' } }, { var: 'state.quorum' }] },
          { '===': [{ var: 'state.marketType' }, 'crowdfund'] },
          { '===': [{ var: 'state.marketType' }, 'group_buy'] },
          { '===': [{ var: 'state.marketType' }, 'auction'] },
        ],
      },
      effect: {
        merge: [
          { var: 'state' },
          {
            status: 'SETTLED',
            settledAt: { var: '$timestamp' },
            finalOutcome: { var: 'event.outcome' },
            settlement: { var: 'event.settlement' },
          },
        ],
      },
    },
  ],
};

// ============================================================================
// Helpers
// ============================================================================

async function generateWallet(): Promise<Wallet> {
  const response = await fetch(`${BRIDGE_URL}/agent/wallet`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to generate wallet: ${response.status}`);
  }
  return response.json() as Promise<Wallet>;
}

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
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

async function waitForState(fiberId: string, expectedState: string, timeoutMs = 30000): Promise<StateMachine | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (response.ok) {
        const data = (await response.json()) as StateMachine;
        if (data?.currentState === expectedState) {
          return data;
        }
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

// ============================================================================
// Tests
// ============================================================================

describe('State Machine E2E Tests', () => {
  let creatorWallet: Wallet;
  let participant1Wallet: Wallet;
  let participant2Wallet: Wallet;
  let marketFiberId: string;

  beforeAll(async () => {
    // Check bridge is running
    const healthResponse = await fetch(`${BRIDGE_URL}/health`);
    expect(healthResponse.ok).toBeTruthy();

    // Check ML0 is running
    const ml0Response = await fetch(`${ML0_URL}/node/info`);
    expect(ml0Response.ok).toBeTruthy();

    // Generate test wallets
    creatorWallet = await generateWallet();
    participant1Wallet = await generateWallet();
    participant2Wallet = await generateWallet();

    console.log(`  Creator: ${creatorWallet.address}`);
    console.log(`  Participant 1: ${participant1Wallet.address}`);
    console.log(`  Participant 2: ${participant2Wallet.address}`);
  });

  describe('POST /sm/create - Create State Machine', () => {
    it('should create a Market state machine', async () => {
      const initialData = {
        schema: 'Market',
        marketType: 'prediction',
        title: 'E2E Test Prediction Market',
        description: 'Will this test pass?',
        terms: {
          question: 'Will this E2E test complete successfully?',
          outcomes: ['YES', 'NO'],
          feePercent: 2,
        },
        deadline: null,
        threshold: null,
        oracles: [],
        quorum: 1,
        commitments: {},
        totalCommitted: 0,
        resolutions: [],
        claims: {},
        status: 'PROPOSED',
      };

      const response = await fetch(`${BRIDGE_URL}/sm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          definition: MarketDefinition,
          initialData,
        }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as CreateSMResult;
      expect(result.fiberId).toBeTruthy();
      expect(result.hash).toBeTruthy();
      expect(result.creator).toBe(creatorWallet.address);
      expect(result.schema).toBe('Market');

      marketFiberId = result.fiberId;
      console.log(`  ✓ Created Market: ${result.fiberId}`);
      console.log(`    Hash: ${result.hash}`);
    });

    it('should appear on ML0 in PROPOSED state', async () => {
      const fiber = await waitForFiber(marketFiberId);

      expect(fiber).toBeTruthy();
      expect(fiber.currentState).toBe('PROPOSED');
      expect(fiber.stateData.schema).toBe('Market');
      expect(fiber.stateData.creator).toBe(creatorWallet.address);
      expect(fiber.stateData.marketType).toBe('prediction');
      expect(fiber.stateData.status).toBe('PROPOSED');
      expect(fiber.stateData.totalCommitted).toBe(0);

      console.log(`  ✓ Fiber confirmed on ML0: state=${fiber.currentState}`);
    });

    it('should reject invalid definition', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          definition: { metadata: { name: 'Bad' } }, // Missing required fields
          initialData: {},
        }),
      });

      expect(response.status).toBe(400);
      console.log(`  ✓ Rejected invalid definition`);
    });

    it('should reject invalid private key', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: 'not-a-valid-key',
          definition: MarketDefinition,
          initialData: { schema: 'Market' },
        }),
      });

      expect(response.status).toBe(400);
      console.log(`  ✓ Rejected invalid private key`);
    });
  });

  describe('POST /sm/transition - State Transitions', () => {
    it('should open the market (PROPOSED → OPEN)', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          fiberId: marketFiberId,
          eventName: 'open',
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as TransitionResult;
      expect(result.fiberId).toBe(marketFiberId);
      expect(result.eventName).toBe('open');
      expect(result.previousState).toBe('PROPOSED');
      expect(result.hash).toBeTruthy();

      console.log(`  ✓ Transition submitted: ${result.eventName}`);
      console.log(`    Hash: ${result.hash}`);
    });

    it('should transition to OPEN state on ML0', async () => {
      const fiber = await waitForState(marketFiberId, 'OPEN');

      expect(fiber).toBeTruthy();
      expect(fiber.currentState).toBe('OPEN');
      expect(fiber.stateData.status).toBe('OPEN');
      expect(fiber.stateData.openedAt).toBeTruthy();
      expect(fiber.sequenceNumber).toBe(1);

      console.log(`  ✓ Market opened: seq=${fiber.sequenceNumber}`);
    });

    it('should allow participant to commit (OPEN → OPEN)', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          fiberId: marketFiberId,
          eventName: 'commit',
          payload: {
            amount: 100,
            data: { outcome: 'YES' },
          },
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as TransitionResult;
      expect(result.eventName).toBe('commit');
      expect(result.previousState).toBe('OPEN');

      console.log(`  ✓ Participant 1 committed 100`);
    });

    it('should update commitment data on ML0', async () => {
      // Wait a bit for the transaction to be processed
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const response = await fetch(`${BRIDGE_URL}/sm/${marketFiberId}`);
      expect(response.status).toBe(200);

      const fiber = (await response.json()) as StateMachine;
      expect(fiber.currentState).toBe('OPEN');
      expect(fiber.stateData.totalCommitted).toBe(100);

      const commitments = fiber.stateData.commitments as Record<string, { amount: number; data: { outcome: string } }>;
      const p1Commitment = commitments[participant1Wallet.address];
      expect(p1Commitment).toBeTruthy();
      expect(p1Commitment.amount).toBe(100);
      expect(p1Commitment.data?.outcome).toBe('YES');

      console.log(`  ✓ Commitment verified: ${participant1Wallet.address.slice(0, 12)}... = 100`);
    });

    it('should allow second participant to commit', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant2Wallet.privateKey,
          fiberId: marketFiberId,
          eventName: 'commit',
          payload: {
            amount: 250,
            data: { outcome: 'NO' },
          },
        }),
      });

      expect(response.status).toBe(200);
      console.log(`  ✓ Participant 2 committed 250`);

      // Wait and verify
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const fiber = await waitForFiber(marketFiberId);
      expect(fiber?.stateData.totalCommitted).toBe(350);
      console.log(`  ✓ Total committed: 350`);
    });

    it('should close the market (OPEN → CLOSED)', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          fiberId: marketFiberId,
          eventName: 'close',
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as TransitionResult;
      expect(result.eventName).toBe('close');

      console.log(`  ✓ Close transition submitted`);
    });

    it('should transition to CLOSED state on ML0', async () => {
      const fiber = await waitForState(marketFiberId, 'CLOSED');

      expect(fiber).toBeTruthy();
      expect(fiber.currentState).toBe('CLOSED');
      expect(fiber.stateData.status).toBe('CLOSED');
      expect(fiber.stateData.closedAt).toBeTruthy();

      console.log(`  ✓ Market closed: state=${fiber.currentState}`);
    });

    it('should reject non-creator trying to open market', async () => {
      // First, create a new market for this test
      const newMarketResponse = await fetch(`${BRIDGE_URL}/sm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          definition: MarketDefinition,
          initialData: {
            schema: 'Market',
            marketType: 'prediction',
            title: 'Guard Test Market',
            commitments: {},
            totalCommitted: 0,
            resolutions: [],
            claims: {},
            status: 'PROPOSED',
          },
        }),
      });

      const newMarket = (await newMarketResponse.json()) as CreateSMResult;
      await waitForFiber(newMarket.fiberId);

      // Try to open with non-creator (guard should fail)
      const openResponse = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          fiberId: newMarket.fiberId,
          eventName: 'open',
        }),
      });

      // Transition might succeed at bridge level but fail on-chain due to guard
      // The bridge doesn't validate guards, the metagraph does
      expect(openResponse.ok).toBeTruthy();

      // Wait and verify state didn't change
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const fiber = await waitForFiber(newMarket.fiberId);
      expect(fiber?.currentState).toBe('PROPOSED');

      console.log(`  ✓ Guard prevented non-creator from opening market`);
    });

    it('should reject transition for non-existent fiberId', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          fiberId: '00000000-0000-0000-0000-000000000000',
          eventName: 'open',
        }),
      });

      expect(response.status).toBe(404);
      console.log(`  ✓ Rejected transition for non-existent fiber`);
    });
  });

  describe('GET /sm/:fiberId - Query State Machine', () => {
    it('should return state machine by ID', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/${marketFiberId}`);
      expect(response.status).toBe(200);

      const fiber = (await response.json()) as StateMachine;
      expect(fiber.fiberId).toBe(marketFiberId);
      expect(fiber.currentState).toBe('CLOSED');
      expect(fiber.definition.metadata.name).toBe('Market');
      expect(fiber.stateData.commitments).toBeTruthy();
      expect(fiber.stateData.totalCommitted).toBe(350);

      console.log(`  ✓ Queried market: ${fiber.fiberId}`);
      console.log(`    State: ${fiber.currentState}, Total: ${fiber.stateData.totalCommitted}`);
    });

    it('should return 404 for non-existent ID', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/00000000-0000-0000-0000-000000000000`);
      expect(response.status).toBe(404);
      console.log(`  ✓ Returned 404 for non-existent ID`);
    });
  });

  describe('GET /sm?schema=Market - List State Machines', () => {
    it('should list all state machines', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;
      expect(result.total >= 1).toBeTruthy();
      expect(result.count >= 1).toBeTruthy();
      expect(result.stateMachines).toBeTruthy();

      console.log(`  ✓ Listed ${result.count} state machines (total: ${result.total})`);
    });

    it('should filter by schema=Market', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm?schema=Market`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;
      expect(result.count >= 1).toBeTruthy();

      // Verify all returned items are Markets
      for (const [id, sm] of Object.entries(result.stateMachines)) {
        const isMarket = sm.stateData?.schema === 'Market' || sm.definition?.metadata?.name === 'Market';
        expect(isMarket).toBeTruthy();
      }

      console.log(`  ✓ Filtered by schema=Market: ${result.count} markets`);
    });

    it('should filter by status=CLOSED', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm?schema=Market&status=CLOSED`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;

      // Verify all returned items are CLOSED
      for (const [id, sm] of Object.entries(result.stateMachines)) {
        const isClosed = sm.stateData?.status === 'CLOSED' || sm.currentState === 'CLOSED';
        expect(isClosed).toBeTruthy();
      }

      console.log(`  ✓ Filtered by status=CLOSED: ${result.count} closed markets`);
    });

    it('should filter by creator', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm?creator=${creatorWallet.address}`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;
      expect(result.count >= 1).toBeTruthy();

      // Verify all returned items are from creator
      for (const [id, sm] of Object.entries(result.stateMachines)) {
        expect(sm.stateData?.creator, creatorWallet.address).toBe(`${id} should be from creator`);
      }

      console.log(`  ✓ Filtered by creator: ${result.count} markets`);
    });

    it('should filter by marketType=prediction', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm?marketType=prediction`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;

      // Verify all returned items are predictions
      for (const [id, sm] of Object.entries(result.stateMachines)) {
        expect(sm.stateData?.marketType, 'prediction').toBe(`${id} should be prediction market`);
      }

      console.log(`  ✓ Filtered by marketType=prediction: ${result.count} prediction markets`);
    });

    it('should support pagination', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm?limit=1&offset=0`);
      expect(response.status).toBe(200);

      const result = (await response.json()) as ListResult;
      expect(result.limit).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.count <= 1).toBeTruthy();

      console.log(`  ✓ Pagination works: limit=1, offset=0, got ${result.count}`);
    });
  });

  describe('POST /sm/:fiberId/commit - Convenience Endpoint', () => {
    let openMarketId: string;

    beforeAll(async () => {
      // Create a new market for commit tests
      const createResponse = await fetch(`${BRIDGE_URL}/sm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          definition: MarketDefinition,
          initialData: {
            schema: 'Market',
            marketType: 'crowdfund',
            title: 'Commit Endpoint Test',
            description: 'Testing the convenience commit endpoint',
            commitments: {},
            totalCommitted: 0,
            resolutions: [],
            claims: {},
            status: 'PROPOSED',
          },
        }),
      });

      const createResult = (await createResponse.json()) as CreateSMResult;
      openMarketId = createResult.fiberId;
      await waitForFiber(openMarketId);

      // Open the market
      await fetch(`${BRIDGE_URL}/sm/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: creatorWallet.privateKey,
          fiberId: openMarketId,
          eventName: 'open',
        }),
      });

      await waitForState(openMarketId, 'OPEN');
      console.log(`  Created test market: ${openMarketId}`);
    });

    it('should commit via convenience endpoint', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/${openMarketId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          amount: 500,
          data: { pledgeNote: 'Happy to support!' },
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as CommitResult;
      expect(result.fiberId).toBe(openMarketId);
      expect(result.agent).toBe(participant1Wallet.address);
      expect(result.amount).toBe(500);
      expect(result.hash).toBeTruthy();

      console.log(`  ✓ Committed via convenience endpoint: ${result.amount}`);
    });

    it('should update state after convenience commit', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const response = await fetch(`${BRIDGE_URL}/sm/${openMarketId}`);
      const fiber = (await response.json()) as StateMachine;

      expect(fiber.stateData.totalCommitted).toBe(500);

      console.log(`  ✓ State updated: totalCommitted=${fiber.stateData.totalCommitted}`);
    });

    it('should reject commit on closed market', async () => {
      // Use the main test market which is CLOSED
      const response = await fetch(`${BRIDGE_URL}/sm/${marketFiberId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          amount: 100,
        }),
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error.error.includes('not open')).toBeTruthy();
      expect(error.currentState).toBe('CLOSED');

      console.log(`  ✓ Rejected commit on closed market`);
    });

    it('should reject commit with invalid amount', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/${openMarketId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          amount: -100,
        }),
      });

      expect(response.status).toBe(400);
      console.log(`  ✓ Rejected commit with invalid amount`);
    });

    it('should reject commit with missing privateKey', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/${openMarketId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 100,
        }),
      });

      expect(response.status).toBe(400);
      console.log(`  ✓ Rejected commit with missing privateKey`);
    });

    it('should reject commit on non-existent market', async () => {
      const response = await fetch(`${BRIDGE_URL}/sm/00000000-0000-0000-0000-000000000000/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: participant1Wallet.privateKey,
          amount: 100,
        }),
      });

      expect(response.status).toBe(404);
      console.log(`  ✓ Rejected commit on non-existent market`);
    });
  });
});

// Run info if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('\n🧪 Running State Machine E2E Tests\n');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ML0: ${ML0_URL}\n`);
}
