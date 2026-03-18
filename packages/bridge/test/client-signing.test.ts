/**
 * [B2] TDD Tests: Client-Side Signing Endpoints
 *
 * These tests MUST FAIL before implementation (TDD red phase).
 * They verify the Build → Sign → Submit flow specified in:
 *   docs/design/client-side-signing-spec.md
 *
 * Endpoints under test:
 *   POST /build/sm/create    — returns unsigned CreateStateMachine
 *   POST /build/sm/transition — returns unsigned TransitionStateMachine
 *   POST /submit             — accepts Signed<OttochainMessage>, relays to DL1
 *
 * Also verifies:
 *   - Deprecated /sm/create and /sm/transition (with privateKey) still work
 *   - Sequence number handling for consecutive transitions
 *
 * Requires a running OttoChain cluster + bridge:
 *   BRIDGE_URL=http://localhost:3030
 *   ML0_URL=http://localhost:9200
 *
 * Run:
 *   pnpm test:client-signing
 *   # or
 *   node --test --experimental-strip-types test/client-signing.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// SDK transaction helpers (from feat/signing-modes branch)
import {
  generateKeyPair,
  signTransaction,
  addTransactionSignature,
} from '@ottochain/sdk';

// ============================================================================
// Config
// ============================================================================

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

interface BuildCreateResponse {
  fiberId: string;
  unsigned: {
    CreateStateMachine: {
      fiberId: string;
      definition: Record<string, unknown>;
      initialData: Record<string, unknown>;
      participants?: string[];
    };
  };
}

interface BuildTransitionResponse {
  unsigned: {
    TransitionStateMachine: {
      fiberId: string;
      eventName: string;
      payload: Record<string, unknown>;
      targetSequenceNumber: number;
    };
  };
  currentState: string;
}

interface SubmitResponse {
  hash: string;
  messageType: string;
  fiberId: string;
}

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

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json() as T;
  return { status: response.status, body: responseBody };
}

async function waitForFiber(
  fiberId: string,
  timeoutMs = 30000
): Promise<{ fiberId: string; currentState: string; sequenceNumber: number } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
      if (res.ok) {
        const data = await res.json() as { fiberId: string; currentState: string; sequenceNumber: number };
        if (data?.fiberId) return data;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ============================================================================
// Fixtures
// ============================================================================

const SimpleDef = {
  metadata: { name: 'TestSM', version: '1.0.0' },
  states: {
    CREATED: { id: 'CREATED', isFinal: false },
    ACTIVE: { id: 'ACTIVE', isFinal: false },
    CLOSED: { id: 'CLOSED', isFinal: true },
  },
  initialState: 'CREATED',
  transitions: [
    { from: 'CREATED', to: 'ACTIVE', eventName: 'advance' },
    { from: 'ACTIVE', to: 'CLOSED', eventName: 'close' },
  ],
};

// ============================================================================
// Test Suite
// ============================================================================

describe('[B2] Client-Side Signing Endpoints', () => {
  let wallet: Wallet;

  before(async () => {
    wallet = await generateWallet();
  });

  // -------------------------------------------------------------------------
  // Group 1: Build Endpoints Return Unsigned Messages
  // -------------------------------------------------------------------------

  describe('Group 1: POST /build/sm/create returns unsigned payload', () => {
    it('T1.1 — returns fiberId + unsigned CreateStateMachine (no privateKey in response)', async () => {
      const { status, body } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: { status: 'OPEN' },
      });

      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.fiberId, 'Should have fiberId');
      assert.ok(isValidUUID(body.fiberId), `fiberId should be a UUID, got: ${body.fiberId}`);
      assert.ok(body.unsigned?.CreateStateMachine, 'Should have unsigned.CreateStateMachine');
      assert.strictEqual(body.unsigned.CreateStateMachine.fiberId, body.fiberId, 'fiberId should match');
      assert.deepStrictEqual(body.unsigned.CreateStateMachine.definition, SimpleDef, 'definition round-trips');
      assert.ok(!JSON.stringify(body).includes('"privateKey"'), 'Response must not contain privateKey');
      console.log(`  ✓ T1.1: fiberId=${body.fiberId}`);
    });

    it('T1.2 — participants field passes through to unsigned message', async () => {
      const participants = ['DAG1fake0000000000000000000000000000000000001'];
      const { status, body } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
        participants,
      });

      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.deepStrictEqual(body.unsigned.CreateStateMachine.participants, participants);
      console.log(`  ✓ T1.2: participants forwarded`);
    });

    it('T1.3 — fiberId hint in request is used', async () => {
      const hintId = '11111111-2222-3333-4444-555555555555';
      const { status, body } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
        fiberId: hintId,
      });

      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.strictEqual(body.fiberId, hintId);
      assert.strictEqual(body.unsigned.CreateStateMachine.fiberId, hintId);
      console.log(`  ✓ T1.3: fiberId hint respected`);
    });

    it('T1.4 — POST /build/sm/transition returns message with sequenceNumber + currentState', async () => {
      const createRes = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
      });
      assert.strictEqual(createRes.status, 200, 'Build create must succeed for T1.4 setup');
      const fiberId = createRes.body.fiberId;

      const { status, body } = await post<BuildTransitionResponse>('/build/sm/transition', {
        fiberId,
        eventName: 'advance',
        payload: {},
      });

      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.unsigned?.TransitionStateMachine, 'Should have unsigned.TransitionStateMachine');
      assert.strictEqual(body.unsigned.TransitionStateMachine.eventName, 'advance');
      assert.ok(typeof body.unsigned.TransitionStateMachine.targetSequenceNumber === 'number', 'targetSequenceNumber must be number');
      assert.ok(body.unsigned.TransitionStateMachine.targetSequenceNumber >= 0, 'targetSequenceNumber must be >= 0');
      assert.ok(typeof body.currentState === 'string', 'currentState must be string');
      assert.ok(!JSON.stringify(body).includes('"privateKey"'), 'Response must not contain privateKey');
      console.log(`  ✓ T1.4: targetSequenceNumber=${body.unsigned.TransitionStateMachine.targetSequenceNumber}, currentState=${body.currentState}`);
    });
  });

  // -------------------------------------------------------------------------
  // Group 2: POST /submit Accepts Signed Transactions
  // -------------------------------------------------------------------------

  describe('Group 2: POST /submit accepts signed transactions', () => {
    it('T2.1 — Full round-trip: build → sign (client-side) → submit returns hash', async () => {
      // Build
      const { status: buildStatus, body: buildBody } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: { status: 'OPEN' },
      });
      assert.strictEqual(buildStatus, 200, `Build failed: ${JSON.stringify(buildBody)}`);

      // Sign locally (private key never leaves client)
      const keyPair = generateKeyPair();
      const signed = await signTransaction(buildBody.unsigned.CreateStateMachine, keyPair.privateKey);

      // Submit
      const { status, body } = await post<SubmitResponse>('/submit', {
        signed: { value: buildBody.unsigned.CreateStateMachine, proofs: signed.proofs },
      });

      assert.strictEqual(status, 200, `Submit failed: ${JSON.stringify(body)}`);
      assert.ok(body.hash?.length > 0, 'hash should be non-empty');
      assert.strictEqual(body.messageType, 'CreateStateMachine');
      assert.strictEqual(body.fiberId, buildBody.fiberId);
      console.log(`  ✓ T2.1: hash=${body.hash}`);
    });

    it('T2.2 — Submit with malformed signature returns 422', async () => {
      const { status: buildStatus, body: buildBody } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
      });
      assert.strictEqual(buildStatus, 200);

      const { status, body } = await post<{ error: string }>('/submit', {
        signed: {
          value: buildBody.unsigned.CreateStateMachine,
          proofs: [{ id: 'fakeid', signature: '0000000000' }],
        },
      });

      assert.strictEqual(status, 422, `Expected 422, got ${status}: ${JSON.stringify(body)}`);
      const errLower = (body.error ?? '').toLowerCase();
      assert.ok(errLower.includes('reject') || errLower.includes('signature') || errLower.includes('invalid'),
        `Error should mention rejection/signature: ${body.error}`);
      console.log(`  ✓ T2.2: invalid signature → 422`);
    });

    it('T2.3 — Submit with proof for different message returns 422', async () => {
      const [resA, resB] = await Promise.all([
        post<BuildCreateResponse>('/build/sm/create', { definition: SimpleDef, initialData: { n: 'A' } }),
        post<BuildCreateResponse>('/build/sm/create', { definition: SimpleDef, initialData: { n: 'B' } }),
      ]);
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resB.status, 200);

      const keyPair = generateKeyPair();
      const signedB = await signTransaction(resB.body.unsigned.CreateStateMachine, keyPair.privateKey);

      // Submit A with proof for B
      const { status, body } = await post<{ error: string }>('/submit', {
        signed: {
          value: resA.body.unsigned.CreateStateMachine,
          proofs: signedB.proofs,
        },
      });

      assert.strictEqual(status, 422, `Expected 422 for mismatched proof, got ${status}: ${JSON.stringify(body)}`);
      console.log(`  ✓ T2.3: mismatched proof → 422`);
    });

    it('T2.4 — Submit unknown message type returns 400', async () => {
      const keyPair = generateKeyPair();
      const unknown = { UnknownMessage: { someField: 'value' } };
      const signed = await signTransaction(unknown, keyPair.privateKey);

      const { status, body } = await post<{ error: string }>('/submit', {
        signed: { value: unknown, proofs: signed.proofs },
      });

      assert.strictEqual(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
      console.log(`  ✓ T2.4: unknown message type → 400`);
    });
  });

  // -------------------------------------------------------------------------
  // Group 3: Deprecated Endpoints Backward Compatibility
  // -------------------------------------------------------------------------

  describe('Group 3: Deprecated endpoints still work (privateKey in body)', () => {
    it('T3.1 — POST /sm/create with privateKey returns 201 + fiberId', async () => {
      const { status, body } = await post<{ fiberId: string; _deprecated?: string }>('/sm/create', {
        privateKey: wallet.privateKey,
        definition: SimpleDef,
        initialData: { status: 'OPEN' },
      });

      assert.strictEqual(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.fiberId, 'Should have fiberId');
      assert.ok(isValidUUID(body.fiberId), `fiberId should be UUID: ${body.fiberId}`);
      console.log(`  ✓ T3.1: deprecated /sm/create still works`);
    });

    it('T3.2 — POST /sm/transition with privateKey still works', async () => {
      // Create via deprecated endpoint
      const createRes = await post<{ fiberId: string }>('/sm/create', {
        privateKey: wallet.privateKey,
        definition: SimpleDef,
        initialData: {},
      });
      assert.strictEqual(createRes.status, 201);
      const fiberId = createRes.body.fiberId;

      const fiber = await waitForFiber(fiberId);
      assert.ok(fiber, `Fiber ${fiberId} did not appear on-chain`);

      const { status, body } = await post<{ hash: string }>('/sm/transition', {
        privateKey: wallet.privateKey,
        fiberId,
        eventName: 'advance',
        payload: {},
      });

      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.hash, 'Should have hash');
      console.log(`  ✓ T3.2: deprecated /sm/transition still works`);
    });
  });

  // -------------------------------------------------------------------------
  // Group 4: Sequence Number Handling
  // -------------------------------------------------------------------------

  describe('Group 4: Sequence number handling', () => {
    it('T4.1 — first transition after create has targetSequenceNumber == 0', async () => {
      const createBuild = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
      });
      assert.strictEqual(createBuild.status, 200);
      const fiberId = createBuild.body.fiberId;

      const keyPair = generateKeyPair();
      const signed = await signTransaction(createBuild.body.unsigned.CreateStateMachine, keyPair.privateKey);
      const submitRes = await post<SubmitResponse>('/submit', {
        signed: { value: createBuild.body.unsigned.CreateStateMachine, proofs: signed.proofs },
      });
      assert.strictEqual(submitRes.status, 200, `Create submit failed: ${JSON.stringify(submitRes.body)}`);

      const fiber = await waitForFiber(fiberId);
      assert.ok(fiber, `Fiber ${fiberId} did not appear on-chain`);

      const { status, body } = await post<BuildTransitionResponse>('/build/sm/transition', {
        fiberId,
        eventName: 'advance',
        payload: {},
      });

      assert.strictEqual(status, 200, `Build transition failed: ${JSON.stringify(body)}`);
      assert.strictEqual(
        body.unsigned.TransitionStateMachine.targetSequenceNumber,
        0,
        `Expected targetSequenceNumber=0, got ${body.unsigned.TransitionStateMachine.targetSequenceNumber}`
      );
      console.log(`  ✓ T4.1: first transition targetSequenceNumber=0`);
    });

    it('T4.2 — second transition has targetSequenceNumber == 1', async () => {
      const createBuild = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
      });
      assert.strictEqual(createBuild.status, 200);
      const fiberId = createBuild.body.fiberId;
      const keyPair = generateKeyPair();

      // Submit create
      const signedCreate = await signTransaction(createBuild.body.unsigned.CreateStateMachine, keyPair.privateKey);
      const s0 = await post<SubmitResponse>('/submit', {
        signed: { value: createBuild.body.unsigned.CreateStateMachine, proofs: signedCreate.proofs },
      });
      assert.strictEqual(s0.status, 200);

      const fiberAfterCreate = await waitForFiber(fiberId);
      assert.ok(fiberAfterCreate, 'Fiber should appear after create');

      // Build + submit first transition (seq 0)
      const t0Build = await post<BuildTransitionResponse>('/build/sm/transition', {
        fiberId, eventName: 'advance', payload: {},
      });
      assert.strictEqual(t0Build.status, 200);
      assert.strictEqual(t0Build.body.unsigned.TransitionStateMachine.targetSequenceNumber, 0);

      const signedT0 = await signTransaction(t0Build.body.unsigned.TransitionStateMachine, keyPair.privateKey);
      const s1 = await post<SubmitResponse>('/submit', {
        signed: { value: t0Build.body.unsigned.TransitionStateMachine, proofs: signedT0.proofs },
      });
      assert.strictEqual(s1.status, 200);

      // Wait for on-chain
      await new Promise((r) => setTimeout(r, 5000));

      // Build second transition → should be seq 1
      const { status, body } = await post<BuildTransitionResponse>('/build/sm/transition', {
        fiberId, eventName: 'close', payload: {},
      });

      assert.strictEqual(status, 200, `Second build failed: ${JSON.stringify(body)}`);
      assert.strictEqual(
        body.unsigned.TransitionStateMachine.targetSequenceNumber,
        1,
        `Expected targetSequenceNumber=1, got ${body.unsigned.TransitionStateMachine.targetSequenceNumber}`
      );
      console.log(`  ✓ T4.2: second transition targetSequenceNumber=1`);
    });
  });

  // -------------------------------------------------------------------------
  // Group 5: Multi-signature (addTransactionSignature)
  // -------------------------------------------------------------------------

  describe('Group 5: Multi-signature via addTransactionSignature', () => {
    it('T5.1 — /submit accepts transaction with 2 proofs', async () => {
      const { status: buildStatus, body: buildBody } = await post<BuildCreateResponse>('/build/sm/create', {
        definition: SimpleDef,
        initialData: {},
        participants: ['DAG1fake0000000000000000000000000000000000002'],
      });
      assert.strictEqual(buildStatus, 200);

      const alice = generateKeyPair();
      const bob = generateKeyPair();

      let signed = await signTransaction(buildBody.unsigned.CreateStateMachine, alice.privateKey);
      signed = await addTransactionSignature(signed, bob.privateKey);

      assert.strictEqual(signed.proofs.length, 2, 'Should have 2 proofs');
      assert.notStrictEqual(signed.proofs[0].id, signed.proofs[1].id, 'Proofs should differ');

      const { status, body } = await post<SubmitResponse>('/submit', {
        signed: { value: buildBody.unsigned.CreateStateMachine, proofs: signed.proofs },
      });

      assert.strictEqual(status, 200, `Multi-signed submit failed: ${JSON.stringify(body)}`);
      assert.ok(body.hash, 'Should have hash');
      console.log(`  ✓ T5.1: multi-signed transaction accepted`);
    });
  });
});
