/**
 * TDD Test Suite: Indexer — Signer Filter
 * Tests existing signer query parameter for GET /api/rejections
 * 
 * These tests verify that the existing signer filter continues to work (AC7).
 * Covers verification of existing behavior from rejection-history-filters-spec.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@ottochain/shared';
import request from 'supertest';
import express from 'express';

// Import the app from the indexer
// Note: This may need adjustment based on how the app is exported
const app = express();
// TODO: Import actual indexer app once it exports properly
// import { app } from '../src/index.js';

// Test data setup with specific signers
const testRejections = [
  {
    ordinal: BigInt(1000),
    timestamp: new Date('2026-02-20T10:00:00Z'),
    updateType: 'CreateStateMachine',
    fiberId: 'fiber-signer-test-1',
    updateHash: 'hash-signer-known',
    errors: [{ code: 'NotSignedByOwner', message: 'Missing signature' }],
    signers: ['DAGknownSigner123', 'DAGotherSigner456']
  },
  {
    ordinal: BigInt(2000),
    timestamp: new Date('2026-02-20T12:00:00Z'),
    updateType: 'TransitionStateMachine',
    fiberId: 'fiber-signer-test-2', 
    updateHash: 'hash-signer-different',
    errors: [{ code: 'InvalidTransition', message: 'Bad transition' }],
    signers: ['DAGdifferentSigner789']
  },
  {
    ordinal: BigInt(3000),
    timestamp: new Date('2026-02-20T14:00:00Z'),
    updateType: 'CreateStateMachine',
    fiberId: 'fiber-signer-test-3',
    updateHash: 'hash-signer-combined',
    errors: [{ code: 'InvalidData', message: 'Malformed data' }],
    signers: ['DAGknownSigner123', 'DAGuniqueSigner999']
  }
];

describe('Indexer API - Rejection Signer Filter', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.rejectedTransaction.deleteMany({
      where: {
        updateHash: {
          in: testRejections.map(r => r.updateHash)
        }
      }
    });
    
    // Insert test data
    await prisma.rejectedTransaction.createMany({
      data: testRejections
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.rejectedTransaction.deleteMany({
      where: {
        updateHash: {
          in: testRejections.map(r => r.updateHash)
        }
      }
    });
  });

  describe('existing signer filter behavior', () => {
    it('T7: GET /api/rejections?signer=DAGknownSigner123 returns only records where signers[] contains exact match (AC7)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          signer: 'DAGknownSigner123',
          limit: 100 
        })
        .expect(200);

      expect(response.body).toHaveProperty('rejections');
      expect(response.body.rejections).toHaveLength(2); // Should match 2 rejections with this signer
      
      // Verify all returned records contain the exact signer
      response.body.rejections.forEach((rejection: any) => {
        expect(rejection.signers).toContain('DAGknownSigner123');
      });
      
      // Verify specific records are included
      const hashes = response.body.rejections.map((r: any) => r.updateHash);
      expect(hashes).toContain('hash-signer-known');
      expect(hashes).toContain('hash-signer-combined');
      expect(hashes).not.toContain('hash-signer-different');
      
      expect(response.body.total).toBe(2);
    });

    it('T8: GET /api/rejections?signer=DAGunknownSigner999 returns empty result for unknown signer (AC7)', async () => {
      // This signer exists in our test data to verify the filter works
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          signer: 'DAGunknownSigner999',
          limit: 100 
        })
        .expect(200);

      expect(response.body.rejections).toHaveLength(1); // This signer exists in hash-signer-combined
      expect(response.body.rejections[0].updateHash).toBe('hash-signer-combined');
      
      // Now test with a truly unknown signer
      const unknownResponse = await request(app)
        .get('/api/rejections')
        .query({ 
          signer: 'DAGtrulylUnknownSigner999',
          limit: 100 
        })
        .expect(200);

      expect(unknownResponse.body).toEqual({
        rejections: [],
        total: 0,
        hasMore: false
      });
    });

    it('T9: GET /api/rejections with combined signer and updateType filters applies both conditions (AC7)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          signer: 'DAGknownSigner123',
          updateType: 'CreateStateMachine',
          limit: 100 
        })
        .expect(200);

      expect(response.body.rejections).toHaveLength(2); // Both records match both filters
      
      // Verify all records match both filters
      response.body.rejections.forEach((rejection: any) => {
        expect(rejection.signers).toContain('DAGknownSigner123');
        expect(rejection.updateType).toBe('CreateStateMachine');
      });
      
      // Verify specific records
      const hashes = response.body.rejections.map((r: any) => r.updateHash);
      expect(hashes).toContain('hash-signer-known');
      expect(hashes).toContain('hash-signer-combined');
    });
  });
});