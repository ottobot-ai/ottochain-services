/**
 * Delegation Routes Tests
 *
 * Tests for the delegation bridge API — POST /delegation/create,
 * POST /delegation/submit, POST /delegation/revoke, GET /delegation/:id.
 *
 * Tests follow TDD patterns used throughout the bridge package.
 * Metagraph calls are mocked to avoid live cluster dependency.
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { delegationRoutes } from '../routes/delegation.js';
import * as metagraph from '../metagraph.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../metagraph.js', () => ({
  submitTransaction: vi.fn(),
  getStateMachine: vi.fn(),
  keyPairFromPrivateKey: vi.fn(),
  getFiberSequenceNumber: vi.fn(),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_PRIVATE_KEY = 'a'.repeat(64);
const MOCK_DELEGATE_KEY = 'b'.repeat(64);
const MOCK_USER_ADDRESS = 'DAG1userAddress000000000000000000000000001';
const MOCK_DELEGATE_ADDRESS = 'DAG2delegateAddress0000000000000000000002';
const MOCK_DELEGATION_ID = '11111111-1111-1111-1111-111111111111';
const MOCK_SESSION_KEY_ID = '22222222-2222-2222-2222-222222222222';

const FUTURE_EXPIRY = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // 3h from now
const PAST_EXPIRY = new Date(Date.now() - 60 * 1000).toISOString();            // 1 min ago

const ACTIVE_DELEGATION = {
  delegationId: MOCK_DELEGATION_ID,
  delegatorAddress: MOCK_USER_ADDRESS,
  delegateAddress: MOCK_DELEGATE_ADDRESS,
  sessionKeyId: MOCK_SESSION_KEY_ID,
  scope: {
    allowedOperations: ['transfer', 'vote'],
    allowedContracts: [],
    maxTransactionAmount: '1000',
  },
  expiresAt: FUTURE_EXPIRY,
  status: 'DELEGATION_STATUS_ACTIVE',
  nonce: 0,
  userSignature: 'sig_user_abc123',
};

const VALID_TRANSACTION = {
  operation: 'transfer',
  target: MOCK_DELEGATE_ADDRESS,
  payload: Buffer.from(JSON.stringify({ value: 100 })).toString('base64'),
  sessionSignature: 'sig_session_xyz789',
  transactionNonce: 1,
  amount: '100',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('Delegation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/delegation', delegationRoutes);
    vi.clearAllMocks();

    // Default mock: keypairs
    (metagraph.keyPairFromPrivateKey as Mock).mockImplementation((key: string) => {
      if (key === MOCK_PRIVATE_KEY) {
        return { address: MOCK_USER_ADDRESS, publicKey: 'pub_user', privateKey: key };
      }
      return { address: MOCK_DELEGATE_ADDRESS, publicKey: 'pub_delegate', privateKey: key };
    });

    // Default mock: sequence number
    (metagraph.getFiberSequenceNumber as Mock).mockResolvedValue(0);

    // Default mock: successful transaction
    (metagraph.submitTransaction as Mock).mockResolvedValue({
      hash: 'abc123hash',
      ordinal: 1,
      acceptedBy: 'http://dl1:9400',
    });
  });

  // ── POST /delegation/create ─────────────────────────────────────────────────

  describe('POST /delegation/create', () => {
    it('creates a delegation and returns delegation details', async () => {
      const res = await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegateAddress: MOCK_DELEGATE_ADDRESS,
          scope: {
            allowedOperations: ['transfer', 'vote'],
            allowedContracts: [],
          },
          expiryHours: 12,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        delegatorAddress: MOCK_USER_ADDRESS,
        delegateAddress: MOCK_DELEGATE_ADDRESS,
        txHash: 'abc123hash',
      });
      expect(res.body.delegationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.body.sessionKeyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('submits a CreateDelegation message to metagraph', async () => {
      await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegateAddress: MOCK_DELEGATE_ADDRESS,
          scope: { allowedOperations: ['transfer'] },
        });

      expect(metagraph.submitTransaction).toHaveBeenCalledOnce();
      const [message, key] = (metagraph.submitTransaction as Mock).mock.calls[0];
      expect(message).toHaveProperty('CreateDelegation');
      expect(message.CreateDelegation.delegatorAddress).toBe(MOCK_USER_ADDRESS);
      expect(message.CreateDelegation.delegateAddress).toBe(MOCK_DELEGATE_ADDRESS);
      expect(key).toBe(MOCK_PRIVATE_KEY);
    });

    it('uses default expiryHours=24 when not provided', async () => {
      const before = Date.now();
      const res = await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegateAddress: MOCK_DELEGATE_ADDRESS,
          scope: { allowedOperations: [] },
        });
      const after = Date.now();

      expect(res.status).toBe(201);
      const expiresAt = new Date(res.body.expiresAt).getTime();
      const expectedMin = before + 23.9 * 60 * 60 * 1000;
      const expectedMax = after + 24.1 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(expectedMin);
      expect(expiresAt).toBeLessThan(expectedMax);
    });

    it('rejects expiryHours > 24', async () => {
      const res = await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegateAddress: MOCK_DELEGATE_ADDRESS,
          scope: {},
          expiryHours: 25,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('rejects missing delegateAddress', async () => {
      const res = await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          scope: { allowedOperations: [] },
        });

      expect(res.status).toBe(400);
    });

    it('rejects invalid private key length', async () => {
      const res = await request(app)
        .post('/delegation/create')
        .send({
          userPrivateKey: 'tooshort',
          delegateAddress: MOCK_DELEGATE_ADDRESS,
          scope: {},
        });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /delegation/submit ─────────────────────────────────────────────────

  describe('POST /delegation/submit', () => {
    it('submits a delegated transaction and returns tx hash', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: ACTIVE_DELEGATION,
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        delegationId: MOCK_DELEGATION_ID,
        txHash: 'abc123hash',
      });
    });

    it('forwards a SubmitDelegatedTransaction message to metagraph', async () => {
      await request(app)
        .post('/delegation/submit')
        .send({
          delegation: ACTIVE_DELEGATION,
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(metagraph.submitTransaction).toHaveBeenCalledOnce();
      const [message, key] = (metagraph.submitTransaction as Mock).mock.calls[0];
      expect(message).toHaveProperty('SubmitDelegatedTransaction');
      expect(message.SubmitDelegatedTransaction.delegationId).toBe(MOCK_DELEGATION_ID);
      expect(message.SubmitDelegatedTransaction.operation).toBe('transfer');
      expect(key).toBe(MOCK_DELEGATE_KEY);
    });

    it('rejects expired delegation (status=EXPIRED)', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: { ...ACTIVE_DELEGATION, status: 'DELEGATION_STATUS_EXPIRED' },
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(422);
      expect(res.body.validationErrors[0].errorType).toBe(
        'DELEGATION_VALIDATION_ERROR_DELEGATION_EXPIRED',
      );
      expect(metagraph.submitTransaction).not.toHaveBeenCalled();
    });

    it('rejects expired delegation (expiresAt in the past)', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: { ...ACTIVE_DELEGATION, expiresAt: PAST_EXPIRY },
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(422);
      expect(res.body.validationErrors[0].errorType).toBe(
        'DELEGATION_VALIDATION_ERROR_DELEGATION_EXPIRED',
      );
    });

    it('rejects revoked delegation', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: { ...ACTIVE_DELEGATION, status: 'DELEGATION_STATUS_REVOKED' },
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(422);
      expect(res.body.validationErrors[0].errorType).toBe(
        'DELEGATION_VALIDATION_ERROR_DELEGATION_REVOKED',
      );
    });

    it('rejects operation not in allowedOperations', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: ACTIVE_DELEGATION,
          transaction: { ...VALID_TRANSACTION, operation: 'burn' }, // not in scope
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(422);
      expect(res.body.validationErrors[0].errorType).toBe(
        'DELEGATION_VALIDATION_ERROR_SCOPE_VIOLATION',
      );
    });

    it('rejects amount exceeding maxTransactionAmount', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: ACTIVE_DELEGATION,
          transaction: { ...VALID_TRANSACTION, amount: '9999' }, // scope allows max 1000
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(422);
      expect(res.body.validationErrors[0].errorType).toBe(
        'DELEGATION_VALIDATION_ERROR_SPENDING_LIMIT_EXCEEDED',
      );
    });

    it('allows any operation when allowedOperations is empty', async () => {
      const openScopeDelegation = {
        ...ACTIVE_DELEGATION,
        scope: { ...ACTIVE_DELEGATION.scope, allowedOperations: [] },
      };

      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: openScopeDelegation,
          transaction: { ...VALID_TRANSACTION, operation: 'anything' },
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts short-form status ACTIVE', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: { ...ACTIVE_DELEGATION, status: 'ACTIVE' },
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(200);
    });

    it('returns 400 for missing delegation fields', async () => {
      const res = await request(app)
        .post('/delegation/submit')
        .send({
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(400);
    });

    it('returns 500 when metagraph submission fails', async () => {
      (metagraph.submitTransaction as Mock).mockRejectedValue(new Error('DL1 unavailable'));

      const res = await request(app)
        .post('/delegation/submit')
        .send({
          delegation: ACTIVE_DELEGATION,
          transaction: VALID_TRANSACTION,
          sessionKeyPrivateKey: MOCK_DELEGATE_KEY,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DL1 unavailable');
    });
  });

  // ── POST /delegation/revoke ─────────────────────────────────────────────────

  describe('POST /delegation/revoke', () => {
    it('revokes a delegation and returns success', async () => {
      const res = await request(app)
        .post('/delegation/revoke')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegationId: MOCK_DELEGATION_ID,
          reason: 'No longer needed',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        delegationId: MOCK_DELEGATION_ID,
        revokedBy: MOCK_USER_ADDRESS,
        txHash: 'abc123hash',
      });
    });

    it('submits a RevokeDelegation message to metagraph', async () => {
      await request(app)
        .post('/delegation/revoke')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegationId: MOCK_DELEGATION_ID,
          reason: 'Testing',
        });

      expect(metagraph.submitTransaction).toHaveBeenCalledOnce();
      const [message] = (metagraph.submitTransaction as Mock).mock.calls[0];
      expect(message).toHaveProperty('RevokeDelegation');
      expect(message.RevokeDelegation.delegationId).toBe(MOCK_DELEGATION_ID);
      expect(message.RevokeDelegation.reason).toBe('Testing');
    });

    it('works without a reason (defaults to empty string)', async () => {
      const res = await request(app)
        .post('/delegation/revoke')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegationId: MOCK_DELEGATION_ID,
        });

      expect(res.status).toBe(200);
      const [message] = (metagraph.submitTransaction as Mock).mock.calls[0];
      expect(message.RevokeDelegation.reason).toBe('');
    });

    it('rejects non-UUID delegationId', async () => {
      const res = await request(app)
        .post('/delegation/revoke')
        .send({
          userPrivateKey: MOCK_PRIVATE_KEY,
          delegationId: 'not-a-uuid',
        });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /delegation/:delegationId ───────────────────────────────────────────

  describe('GET /delegation/:delegationId', () => {
    it('returns delegation state from metagraph', async () => {
      (metagraph.getStateMachine as Mock).mockResolvedValue({
        delegationId: MOCK_DELEGATION_ID,
        status: 'DELEGATION_STATUS_ACTIVE',
      });

      const res = await request(app).get(`/delegation/${MOCK_DELEGATION_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.delegationId).toBe(MOCK_DELEGATION_ID);
    });

    it('returns 404 when delegation not found', async () => {
      (metagraph.getStateMachine as Mock).mockResolvedValue(null);

      const res = await request(app).get(`/delegation/${MOCK_DELEGATION_ID}`);

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await request(app).get('/delegation/not-a-uuid');

      expect(res.status).toBe(400);
      expect(metagraph.getStateMachine).not.toHaveBeenCalled();
    });
  });
});
