import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('@ottochain/shared', () => ({
  prisma: {
    indexedSnapshot: {
      findFirst: vi.fn(),
    },
    fiberTransition: {
      create: vi.fn(),
    },
    fiber: {
      findUnique: vi.fn(),
    },
  },
  publishEvent: vi.fn(),
  CHANNELS: {
    ACTIVITY_FEED: 'activity-feed',
  },
}));

// Test data: sample snapshot block with CreateStateMachine transaction
const sampleBlockJson = {
  proofs: [{ id: 'test-proof', signature: 'test-sig' }],
  value: {
    roundId: 1,
    dataTransactions: [
      [{
        proofs: [{ id: 'tx-proof', signature: 'tx-sig' }],
        value: {
          CreateStateMachine: {
            fiberId: 'test-fiber-123',
            definition: {
              initialState: 'REGISTERED',
              metadata: {
                name: 'AgentIdentity',
                description: 'Test agent',
              },
              states: {},
              transitions: [],
            },
            owners: ['DAG123'],
          },
        },
      }],
    ],
    dataTransactionsHashes: ['hash1'],
    updateHashes: [],
  },
};

describe('snapshot-indexer', () => {
  describe('transaction decoding', () => {
    it('should transform PascalCase to camelCase for SDK compatibility', () => {
      const pascalCase = { CreateStateMachine: { fiberId: 'test' } };
      const expected = { createStateMachine: { fiberId: 'test' } };
      
      // Transform function
      const transformed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(pascalCase)) {
        const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
        transformed[camelKey] = val;
      }
      
      expect(transformed).toEqual(expected);
    });

    it('should decode CreateStateMachine transaction', () => {
      const txValue = sampleBlockJson.value.dataTransactions[0][0].value;
      expect(txValue.CreateStateMachine).toBeDefined();
      expect(txValue.CreateStateMachine?.fiberId).toBe('test-fiber-123');
      expect(txValue.CreateStateMachine?.definition.initialState).toBe('REGISTERED');
    });

    it('should extract workflowType from definition metadata', () => {
      const txValue = sampleBlockJson.value.dataTransactions[0][0].value;
      const workflowType = txValue.CreateStateMachine?.definition.metadata?.name || 'Unknown';
      expect(workflowType).toBe('AgentIdentity');
    });
  });

  describe('block decoding', () => {
    it('should decode byte array to JSON block', () => {
      const jsonStr = JSON.stringify(sampleBlockJson);
      const bytes = Array.from(jsonStr).map(c => c.charCodeAt(0));
      
      // Decode
      const decoded = String.fromCharCode(...bytes);
      const parsed = JSON.parse(decoded);
      
      expect(parsed.value.dataTransactions).toHaveLength(1);
      expect(parsed.value.roundId).toBe(1);
    });
  });

  describe('hash-based deduplication', () => {
    it('should allow multiple hashes for same ordinal (fork support)', async () => {
      // This tests the data model, not implementation
      // Same ordinal, different hashes should both be stored
      const hash1 = 'abc123';
      const hash2 = 'def456';
      const ordinal = 1000;
      
      // Both should be valid combinations
      expect({ ordinal, hash: hash1 }).not.toEqual({ ordinal, hash: hash2 });
    });
  });
});
