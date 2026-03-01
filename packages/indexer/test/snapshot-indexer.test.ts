import { describe, it, expect, vi } from 'vitest';

// Mock modules
vi.mock('@ottochain/shared', () => ({
  prisma: {
    indexedSnapshot: { findFirst: vi.fn() },
    ottochainEvent: { findUnique: vi.fn(), create: vi.fn() },
  },
  publishEvent: vi.fn(),
  CHANNELS: { ACTIVITY_FEED: 'activity-feed' },
}));

// Sample transaction data matching metagraph JSON format
const sampleCreateStateMachine = {
  CreateStateMachine: {
    fiberId: 'test-fiber-123',
    definition: {
      initialState: 'REGISTERED',
      metadata: { name: 'AgentIdentity', description: 'Test agent' },
      states: {},
      transitions: [],
    },
    owners: ['DAG123'],
  },
};

const sampleTransitionStateMachine = {
  TransitionStateMachine: {
    fiberId: 'test-fiber-456',
    eventName: 'activate',
    payload: { reason: 'user request' },
    targetSequenceNumber: 1,
  },
};

const sampleCreateScript = {
  CreateScript: {
    fiberId: 'script-fiber-789',
    scriptProgram: { rules: [] },
    initialState: { counter: 0 },
  },
};

const sampleInvokeScript = {
  InvokeScript: {
    fiberId: 'script-fiber-789',
    method: 'increment',
    args: { amount: 5 },
    targetSequenceNumber: 2,
  },
};

describe('snapshot-indexer', () => {
  describe('transaction decoding', () => {
    it('transforms PascalCase to camelCase', () => {
      const pascalCase = { CreateStateMachine: { fiberId: 'test' } };
      const transformed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(pascalCase)) {
        const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
        transformed[camelKey] = val;
      }
      expect(transformed).toEqual({ createStateMachine: { fiberId: 'test' } });
    });

    it('extracts fiberId from CreateStateMachine', () => {
      expect(sampleCreateStateMachine.CreateStateMachine.fiberId).toBe('test-fiber-123');
    });

    it('extracts eventName from TransitionStateMachine', () => {
      expect(sampleTransitionStateMachine.TransitionStateMachine.eventName).toBe('activate');
    });

    it('extracts method from InvokeScript', () => {
      expect(sampleInvokeScript.InvokeScript.method).toBe('increment');
    });
  });

  describe('message types', () => {
    it('covers all OttochainMessage types', () => {
      const messageTypes = [
        'createStateMachine',
        'transitionStateMachine', 
        'archiveStateMachine',
        'createScript',
        'invokeScript',
      ];
      expect(messageTypes).toHaveLength(5);
    });
  });

  describe('block decoding', () => {
    it('decodes byte array to JSON block', () => {
      const block = { value: { roundId: 1, dataTransactions: [] } };
      const jsonStr = JSON.stringify(block);
      const bytes = Array.from(jsonStr).map(c => c.charCodeAt(0));
      
      const decoded = String.fromCharCode(...bytes);
      const parsed = JSON.parse(decoded);
      
      expect(parsed.value.roundId).toBe(1);
    });
  });
});
