/**
 * Token Routes - TDD Tests (FAILING)
 * 
 * These tests should FAIL until the actual `/token/*` routes are implemented.
 * Based on the pattern from market.ts and the token SDK types.
 * 
 * Covers:
 * - POST /token/create (16 token behavior types)
 * - POST /token/transfer (transferable tokens only)
 * - POST /token/split (divisible tokens only)
 * - POST /token/merge (divisible tokens only)
 * - POST /token/burn (all tokens)
 * - POST /token/expire (expirable tokens only)
 * - GET /token/:tokenId
 * - GET /token (list with filters)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app'; // Assuming Express app is exported from app.ts

describe('Token Routes (TDD - Should FAIL)', () => {
  const testPrivateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const testTokenId = '12345678-1234-1234-1234-123456789012';
  
  describe('POST /token/create', () => {
    it('should create NFT token (behavior 8)', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 8, // NFT - transferable, not divisible, not expirable, not governed
          name: 'Test NFT',
          symbol: 'TNFT',
          description: 'Test NFT token',
          initialAmount: 1,
          metadata: { image: 'https://example.com/nft.png' }
        });
      
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        tokenId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        tokenBehavior: 8,
        tokenType: 'NFT',
        creator: expect.stringMatching(/^[0-9a-f]{64}$/),
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        message: expect.stringContaining('Token created')
      });
    });

    it('should create fungible token (behavior 12)', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 12, // Fungible - transferable, divisible, not expirable, not governed
          name: 'Test Token',
          symbol: 'TST',
          description: 'Test fungible token',
          initialAmount: 1000000,
          decimals: 18
        });
      
      expect(response.status).toBe(201);
      expect(response.body.tokenBehavior).toBe(12);
      expect(response.body.tokenType).toBe('FUNGIBLE_TOKEN');
    });

    it('should create soulbound token (behavior 0)', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 0, // Soulbound receipt - not transferable, not divisible, not expirable, not governed
          name: 'Achievement Badge',
          symbol: 'BADGE',
          description: 'Non-transferable achievement',
          initialAmount: 1
        });
      
      expect(response.status).toBe(201);
      expect(response.body.tokenBehavior).toBe(0);
      expect(response.body.tokenType).toBe('SOULBOUND_RECEIPT');
    });

    it('should create expirable license (behavior 3)', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 3, // Governed license - not transferable, not divisible, expirable, governed
          name: 'Software License',
          symbol: 'LIC',
          description: 'Expirable software license',
          initialAmount: 1,
          expiresAtOrdinal: 1000000
        });
      
      expect(response.status).toBe(201);
      expect(response.body.tokenBehavior).toBe(3);
      expect(response.body.tokenType).toBe('GOVERNED_LICENSE');
    });

    it('should validate token behavior is 0-15', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 16, // Invalid - out of range
          name: 'Invalid Token',
          symbol: 'INV',
          initialAmount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid');
    });

    it('should require privateKey', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          tokenBehavior: 8,
          name: 'Test Token',
          symbol: 'TST',
          initialAmount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('privateKey');
    });

    it('should require valid privateKey length', async () => {
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: 'invalid',
          tokenBehavior: 8,
          name: 'Test Token',
          symbol: 'TST',
          initialAmount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('privateKey');
    });
  });

  describe('POST /token/transfer', () => {
    it('should transfer NFT token', async () => {
      const response = await request(app)
        .post('/token/transfer')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          recipient: '1234567890123456789012345678901234567890123456789012345678901234',
          amount: 1
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenId: testTokenId,
        recipient: expect.stringMatching(/^[0-9a-f]{64}$/),
        amount: 1
      });
    });

    it('should transfer partial amount of fungible token', async () => {
      const response = await request(app)
        .post('/token/transfer')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          recipient: '1234567890123456789012345678901234567890123456789012345678901234',
          amount: 100.5
        });
      
      expect(response.status).toBe(200);
      expect(response.body.amount).toBe(100.5);
    });

    it('should reject transfer of soulbound token', async () => {
      const response = await request(app)
        .post('/token/transfer')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId, // Assume this is a soulbound token
          recipient: '1234567890123456789012345678901234567890123456789012345678901234',
          amount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not transferable');
    });

    it('should require valid recipient address', async () => {
      const response = await request(app)
        .post('/token/transfer')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          recipient: 'invalid_address',
          amount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('recipient');
    });
  });

  describe('POST /token/split', () => {
    it('should split fungible token', async () => {
      const response = await request(app)
        .post('/token/split')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          amount: 250.75,
          childTokenId: '87654321-4321-4321-4321-876543210987'
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenId: testTokenId,
        amount: 250.75,
        childTokenId: '87654321-4321-4321-4321-876543210987'
      });
    });

    it('should reject split of non-divisible token', async () => {
      const response = await request(app)
        .post('/token/split')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId, // Assume this is NFT (not divisible)
          amount: 0.5
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not divisible');
    });

    it('should validate split amount > 0', async () => {
      const response = await request(app)
        .post('/token/split')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          amount: 0
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('amount must be positive');
    });
  });

  describe('POST /token/merge', () => {
    it('should merge two fungible token instances', async () => {
      const response = await request(app)
        .post('/token/merge')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          sourceTokenId: '87654321-4321-4321-4321-876543210987',
          amount: 100
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenId: testTokenId,
        sourceTokenId: '87654321-4321-4321-4321-876543210987',
        amount: 100
      });
    });

    it('should reject merge of non-divisible tokens', async () => {
      const response = await request(app)
        .post('/token/merge')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId, // Assume this is NFT
          sourceTokenId: '87654321-4321-4321-4321-876543210987',
          amount: 1
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not divisible');
    });

    it('should require sourceTokenId', async () => {
      const response = await request(app)
        .post('/token/merge')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId,
          amount: 100
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sourceTokenId');
    });
  });

  describe('POST /token/burn', () => {
    it('should burn any token type', async () => {
      const response = await request(app)
        .post('/token/burn')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenId: testTokenId,
        status: 'BURNED'
      });
    });

    it('should reject burn of already burned token', async () => {
      const response = await request(app)
        .post('/token/burn')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId // Assume already burned
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('already burned');
    });
  });

  describe('POST /token/expire', () => {
    it('should expire expirable token', async () => {
      const response = await request(app)
        .post('/token/expire')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenId: testTokenId,
        status: 'EXPIRED'
      });
    });

    it('should reject expire of non-expirable token', async () => {
      const response = await request(app)
        .post('/token/expire')
        .send({
          privateKey: testPrivateKey,
          tokenId: testTokenId // Assume this is NFT (not expirable)
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not expirable');
    });
  });

  describe('GET /token/:tokenId', () => {
    it('should return token state by ID', async () => {
      const response = await request(app)
        .get(`/token/${testTokenId}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        fiberId: testTokenId,
        stateData: expect.objectContaining({
          schema: 'Token',
          tokenBehavior: expect.any(Number),
          tokenType: expect.any(String),
          name: expect.any(String),
          symbol: expect.any(String),
          balance: expect.any(Number),
          status: expect.oneOf(['ACTIVE', 'BURNED', 'EXPIRED'])
        }),
        definition: expect.objectContaining({
          metadata: expect.objectContaining({
            name: expect.stringContaining('Token')
          })
        })
      });
    });

    it('should return 404 for non-existent token', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/token/${nonExistentId}`);
      
      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Token not found');
    });

    it('should validate token ID format', async () => {
      const response = await request(app)
        .get('/token/invalid-uuid');
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid token ID');
    });
  });

  describe('GET /token', () => {
    it('should list all tokens', async () => {
      const response = await request(app)
        .get('/token');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        count: expect.any(Number),
        tokens: expect.any(Object)
      });
    });

    it('should filter tokens by behavior', async () => {
      const response = await request(app)
        .get('/token?tokenBehavior=8'); // NFTs only
      
      expect(response.status).toBe(200);
      expect(response.body.count).toBeGreaterThanOrEqual(0);
      
      // All returned tokens should be NFTs (behavior 8)
      const tokens = Object.values(response.body.tokens);
      tokens.forEach((token: any) => {
        expect(token.stateData?.tokenBehavior).toBe(8);
      });
    });

    it('should filter tokens by status', async () => {
      const response = await request(app)
        .get('/token?status=ACTIVE');
      
      expect(response.status).toBe(200);
      
      // All returned tokens should be active
      const tokens = Object.values(response.body.tokens);
      tokens.forEach((token: any) => {
        expect(token.stateData?.status).toBe('ACTIVE');
      });
    });

    it('should filter tokens by owner', async () => {
      const ownerAddress = '1234567890123456789012345678901234567890123456789012345678901234';
      const response = await request(app)
        .get(`/token?owner=${ownerAddress}`);
      
      expect(response.status).toBe(200);
      
      // All returned tokens should be owned by the specified address
      const tokens = Object.values(response.body.tokens);
      tokens.forEach((token: any) => {
        expect(token.stateData?.owner).toBe(ownerAddress);
      });
    });

    it('should filter tokens by symbol', async () => {
      const response = await request(app)
        .get('/token?symbol=TST');
      
      expect(response.status).toBe(200);
      
      // All returned tokens should have the specified symbol
      const tokens = Object.values(response.body.tokens);
      tokens.forEach((token: any) => {
        expect(token.stateData?.symbol).toBe('TST');
      });
    });

    it('should combine multiple filters', async () => {
      const response = await request(app)
        .get('/token?tokenBehavior=12&status=ACTIVE&symbol=TST');
      
      expect(response.status).toBe(200);
      
      const tokens = Object.values(response.body.tokens);
      tokens.forEach((token: any) => {
        expect(token.stateData?.tokenBehavior).toBe(12);
        expect(token.stateData?.status).toBe('ACTIVE');
        expect(token.stateData?.symbol).toBe('TST');
      });
    });

    it('should handle empty results gracefully', async () => {
      const response = await request(app)
        .get('/token?symbol=NONEXISTENT');
      
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
      expect(response.body.tokens).toEqual({});
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/token/create')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid JSON');
    });

    it('should handle missing content-type', async () => {
      const response = await request(app)
        .post('/token/create')
        .send('some text');
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should handle server errors gracefully', async () => {
      // This test assumes the metagraph is unreachable
      const response = await request(app)
        .post('/token/create')
        .send({
          privateKey: testPrivateKey,
          tokenBehavior: 8,
          name: 'Test Token',
          symbol: 'TST',
          initialAmount: 1
        });
      
      // Expecting either success or graceful server error
      expect([200, 201, 500, 503]).toContain(response.status);
      if (response.status >= 500) {
        expect(response.body.error).toBeDefined();
      }
    });
  });

  describe('Token Behavior Validation', () => {
    const behaviorTests = [
      { behavior: 0, name: 'SOULBOUND_RECEIPT', transferable: false, divisible: false, expirable: false },
      { behavior: 1, name: 'GOVERNED_BADGE', transferable: false, divisible: false, expirable: false },
      { behavior: 8, name: 'NFT', transferable: true, divisible: false, expirable: false },
      { behavior: 12, name: 'FUNGIBLE_TOKEN', transferable: true, divisible: true, expirable: false },
      { behavior: 15, name: 'GOVERNED_EXPIRABLE_FUNGIBLE', transferable: true, divisible: true, expirable: true }
    ];

    behaviorTests.forEach(({ behavior, name, transferable, divisible, expirable }) => {
      it(`should validate behavior ${behavior} (${name}) properties`, async () => {
        const createResponse = await request(app)
          .post('/token/create')
          .send({
            privateKey: testPrivateKey,
            tokenBehavior: behavior,
            name: `Test ${name}`,
            symbol: 'TST',
            initialAmount: divisible ? 1000 : 1,
            ...(expirable ? { expiresAtOrdinal: 1000000 } : {})
          });
        
        expect(createResponse.status).toBe(201);
        expect(createResponse.body.tokenType).toBe(name);
        
        const tokenId = createResponse.body.tokenId;
        
        // Test transfer capability
        const transferResponse = await request(app)
          .post('/token/transfer')
          .send({
            privateKey: testPrivateKey,
            tokenId,
            recipient: '1234567890123456789012345678901234567890123456789012345678901234',
            amount: 1
          });
        
        if (transferable) {
          expect(transferResponse.status).toBe(200);
        } else {
          expect(transferResponse.status).toBe(400);
          expect(transferResponse.body.error).toContain('not transferable');
        }
        
        // Test split capability  
        const splitResponse = await request(app)
          .post('/token/split')
          .send({
            privateKey: testPrivateKey,
            tokenId,
            amount: divisible ? 100 : 0.5
          });
        
        if (divisible) {
          expect(splitResponse.status).toBe(200);
        } else {
          expect(splitResponse.status).toBe(400);
          expect(splitResponse.body.error).toContain('not divisible');
        }
        
        // Test expire capability
        const expireResponse = await request(app)
          .post('/token/expire')
          .send({
            privateKey: testPrivateKey,
            tokenId
          });
        
        if (expirable) {
          expect(expireResponse.status).toBe(200);
        } else {
          expect(expireResponse.status).toBe(400);
          expect(expireResponse.body.error).toContain('not expirable');
        }
      });
    });
  });
});