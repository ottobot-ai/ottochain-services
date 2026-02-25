/**
 * TDD Test Suite: Indexer — Timestamp Range Filter
 * Tests new timestamp_from/timestamp_to query parameters for GET /api/rejections
 * 
 * These tests MUST FAIL until the timestamp filter feature is implemented.
 * Covers Acceptance Criteria AC1-AC6 from rejection-history-filters-spec.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@ottochain/shared';
import request from 'supertest';
import express from 'express';

// Import the app from the indexer
// Note: This may need adjustment based on how the app is exported
const app = express();
// TODO: Import actual indexer app once it exports properly
// import { app } from '../src/index.js';

// Test data setup
const testRejections = [
  {
    ordinal: BigInt(1000),
    timestamp: new Date('2026-01-15T10:00:00Z'),
    updateType: 'CreateStateMachine',
    fiberId: 'fiber-123',
    updateHash: 'hash-jan-15',
    errors: [{ code: 'NotSignedByOwner', message: 'Missing signature' }],
    signers: ['DAGsigner123']
  },
  {
    ordinal: BigInt(2000),
    timestamp: new Date('2026-02-01T12:00:00Z'),
    updateType: 'TransitionStateMachine', 
    fiberId: 'fiber-456',
    updateHash: 'hash-feb-01',
    errors: [{ code: 'InvalidTransition', message: 'Bad transition' }],
    signers: ['DAGsigner456']
  },
  {
    ordinal: BigInt(3000),
    timestamp: new Date('2026-02-15T14:00:00Z'),
    updateType: 'CreateStateMachine',
    fiberId: 'fiber-789',
    updateHash: 'hash-feb-15', 
    errors: [{ code: 'InvalidData', message: 'Malformed data' }],
    signers: ['DAGsigner789']
  }
];

describe('Indexer API - Rejection Timestamp Range Filter', () => {
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

  describe('timestamp_from parameter', () => {
    it('T1: GET /api/rejections?timestamp_from=2026-02-01T00:00:00Z returns only records where timestamp >= 2026-02-01 (AC1)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          timestamp_from: '2026-02-01T00:00:00Z',
          limit: 100 
        })
        .expect(200);

      expect(response.body).toHaveProperty('rejections');
      expect(response.body).toHaveProperty('total');
      expect(response.body.rejections).toHaveLength(2); // Should include Feb 1 and Feb 15, exclude Jan 15
      
      // Verify all returned records have timestamp >= 2026-02-01
      response.body.rejections.forEach((rejection: any) => {
        const rejectionDate = new Date(rejection.timestamp);
        const filterDate = new Date('2026-02-01T00:00:00Z');
        expect(rejectionDate.getTime()).toBeGreaterThanOrEqual(filterDate.getTime());
      });
      
      // Verify specific records are included/excluded
      const hashes = response.body.rejections.map((r: any) => r.updateHash);
      expect(hashes).toContain('hash-feb-01');
      expect(hashes).toContain('hash-feb-15');
      expect(hashes).not.toContain('hash-jan-15');
    });
  });

  describe('timestamp_to parameter', () => {
    it('T2: GET /api/rejections?timestamp_to=2026-02-10T23:59:59Z returns only records where timestamp <= 2026-02-10 (AC2)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          timestamp_to: '2026-02-10T23:59:59Z',
          limit: 100 
        })
        .expect(200);

      expect(response.body.rejections).toHaveLength(2); // Should include Jan 15 and Feb 1, exclude Feb 15
      
      // Verify all returned records have timestamp <= 2026-02-10
      response.body.rejections.forEach((rejection: any) => {
        const rejectionDate = new Date(rejection.timestamp);
        const filterDate = new Date('2026-02-10T23:59:59Z');
        expect(rejectionDate.getTime()).toBeLessThanOrEqual(filterDate.getTime());
      });
      
      // Verify specific records
      const hashes = response.body.rejections.map((r: any) => r.updateHash);
      expect(hashes).toContain('hash-jan-15');
      expect(hashes).toContain('hash-feb-01'); 
      expect(hashes).not.toContain('hash-feb-15');
    });
  });

  describe('combined timestamp range', () => {
    it('T3: GET /api/rejections with both timestamp_from and timestamp_to returns only records in closed interval [timestamp_from, timestamp_to] (AC3)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          timestamp_from: '2026-02-01T00:00:00Z',
          timestamp_to: '2026-02-10T23:59:59Z',
          limit: 100 
        })
        .expect(200);

      expect(response.body.rejections).toHaveLength(1); // Should include only Feb 1
      
      // Verify returned record is in the interval
      const rejection = response.body.rejections[0];
      expect(rejection.updateHash).toBe('hash-feb-01');
      
      const rejectionDate = new Date(rejection.timestamp);
      const fromDate = new Date('2026-02-01T00:00:00Z');
      const toDate = new Date('2026-02-10T23:59:59Z');
      
      expect(rejectionDate.getTime()).toBeGreaterThanOrEqual(fromDate.getTime());
      expect(rejectionDate.getTime()).toBeLessThanOrEqual(toDate.getTime());
    });
  });

  describe('invalid timestamp parameters', () => {
    it('T4: GET /api/rejections?timestamp_from=not-a-date returns 400 Bad Request with descriptive error (AC4)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ timestamp_from: 'not-a-date' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid timestamp_from: must be ISO 8601');
    });

    it('T5: GET /api/rejections?timestamp_to=also-not-a-date returns 400 Bad Request with descriptive error (AC4)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ timestamp_to: 'also-not-a-date' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid timestamp_to: must be ISO 8601');
    });
  });

  describe('empty result set', () => {
    it('T6: GET /api/rejections with future timestamp_from returns empty result set (AC5)', async () => {
      const response = await request(app)
        .get('/api/rejections')
        .query({ 
          timestamp_from: '2030-01-01T00:00:00Z',
          limit: 100 
        })
        .expect(200);

      expect(response.body).toEqual({
        rejections: [],
        total: 0,
        hasMore: false
      });
    });
  });
});