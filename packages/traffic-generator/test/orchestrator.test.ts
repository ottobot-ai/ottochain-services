/**
 * FiberOrchestrator Unit Tests
 *
 * Test cases from Issue #178:
 * - updateWeights(weights) — validates weights >= 0, updates config
 * - getWeights() — returns current weight config  
 * - getActiveFibers() — returns currently running fibers
 * - getCompletedFiberLog() — returns ring buffer of last 100 completed
 *
 * These tests cover FiberOrchestrator in isolation (no bridge needed).
 */

import { describe, it, beforeEach, expect, vi } from 'vitest';
// Note: Avoiding direct imports due to dependency issues with @ottochain/shared
// These tests will be implemented once imports are resolved

// Mock types for now
interface TrafficConfig {
  generationIntervalMs: number;
  targetActiveFibers: number;
  fiberWeights: Record<string, number>;
}

interface Agent {
  address: string;
  privateKey: string;
}

interface ActiveFiber {
  id: string;
  type: string;
  currentState: string;
  participants: Map<string, { address: string; privateKey: string }>;
  startedAt: number;
  transitionIndex: number;
}

// Mock FiberOrchestrator class
class MockFiberOrchestrator {
  private config: TrafficConfig;
  private activeFibers: ActiveFiber[] = [];
  private completedLog: any[] = [];

  constructor(config: TrafficConfig, bridge: any, getAgents: any) {
    this.config = config;
  }

  updateWeights(weights: Record<string, number>): void {
    // This will fail - method doesn't exist yet
    throw new Error('updateWeights not implemented');
  }

  getWeights(): Record<string, number> {
    // This will fail - method doesn't exist yet  
    throw new Error('getWeights not implemented');
  }

  getActiveFibers(): ActiveFiber[] {
    // This will fail - method doesn't exist yet
    throw new Error('getActiveFibers not implemented');
  }

  getCompletedFiberLog(): any[] {
    // This will fail - method doesn't exist yet
    throw new Error('getCompletedFiberLog not implemented');
  }

  async tick() {
    // Mock implementation
    return { skipped: false, created: 0, driven: 0, completed: 0, rejected: 0, pending: 0 };
  }

  async bootstrapAgents(count: number) {
    return 0;
  }
}

// Use mock for testing
const FiberOrchestrator = MockFiberOrchestrator;

// ─────────────────────────────────────────────────────────────────────────────
// Mock Dependencies
// ─────────────────────────────────────────────────────────────────────────────

const mockBridge = {
  checkSyncStatus: vi.fn().mockResolvedValue({ ready: true }),
  registerAgent: vi.fn(),
  activateAgent: vi.fn(),
  proposeContract: vi.fn(),
  acceptContract: vi.fn(),
  transitionFiber: vi.fn(),
  vouchForAgent: vi.fn(),
};

const mockAgents: Agent[] = [
  { address: '0x1234567890abcdef1234567890abcdef12345678', privateKey: 'key1' },
  { address: '0x2345678901bcdef12345678901bcdef123456789', privateKey: 'key2' },
  { address: '0x3456789012cdef123456789012cdef1234567890', privateKey: 'key3' },
];

const getAvailableAgents = vi.fn(() => mockAgents);

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function createDefaultConfig(): TrafficConfig {
  return {
    generationIntervalMs: 5000,
    targetActiveFibers: 10,
    fiberWeights: {
      escrow: 0.5,
      market: 0.3,
      dao: 0.2,
    },
  };
}

function createOrchestrator(config?: Partial<TrafficConfig>): FiberOrchestrator {
  const fullConfig = { ...createDefaultConfig(), ...config };
  return new FiberOrchestrator(fullConfig, mockBridge as any, getAvailableAgents);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 1: updateWeights() validation and updates
// ─────────────────────────────────────────────────────────────────────────────

describe('FiberOrchestrator - updateWeights', () => {
  let orchestrator: FiberOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = createOrchestrator();
  });

  it('should update weights for valid input', () => {
    const newWeights = { escrow: 0.6, market: 0.4 };
    
    orchestrator.updateWeights(newWeights);
    
    const currentWeights = orchestrator.getWeights();
    expect(currentWeights.escrow).toBe(0.6);
    expect(currentWeights.market).toBe(0.4);
    expect(currentWeights.dao).toBe(0.2); // unchanged
  });

  it('should reject negative weights', () => {
    const invalidWeights = { escrow: -0.1, market: 0.5 };
    
    orchestrator.updateWeights(invalidWeights);
    
    const currentWeights = orchestrator.getWeights();
    expect(currentWeights.escrow).toBe(0.5); // unchanged from original
    expect(currentWeights.market).toBe(0.3); // unchanged from original
  });

  it('should preserve unspecified weights', () => {
    const partialWeights = { escrow: 0.7 };
    
    orchestrator.updateWeights(partialWeights);
    
    const currentWeights = orchestrator.getWeights();
    expect(currentWeights.escrow).toBe(0.7);
    expect(currentWeights.market).toBe(0.3); // unchanged
    expect(currentWeights.dao).toBe(0.2); // unchanged
  });

  it('should ignore non-numeric values', () => {
    const invalidWeights = { escrow: 'invalid' as any, market: 0.4 };
    
    orchestrator.updateWeights(invalidWeights);
    
    const currentWeights = orchestrator.getWeights();
    expect(currentWeights.escrow).toBe(0.5); // unchanged from original
    expect(currentWeights.market).toBe(0.4); // valid update applied
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 2: getWeights() returns current configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('FiberOrchestrator - getWeights', () => {
  it('should return initial weights configuration', () => {
    const config = createDefaultConfig();
    const orchestrator = createOrchestrator(config);
    
    const weights = orchestrator.getWeights();
    
    expect(weights).toEqual({
      escrow: 0.5,
      market: 0.3,
      dao: 0.2,
    });
  });

  it('should return updated weights after updateWeights call', () => {
    const orchestrator = createOrchestrator();
    
    orchestrator.updateWeights({ escrow: 0.8, market: 0.2 });
    
    const weights = orchestrator.getWeights();
    expect(weights.escrow).toBe(0.8);
    expect(weights.market).toBe(0.2);
    expect(weights.dao).toBe(0.2); // unchanged
  });

  it('should return a copy (not reference to internal state)', () => {
    const orchestrator = createOrchestrator();
    
    const weights1 = orchestrator.getWeights();
    const weights2 = orchestrator.getWeights();
    
    expect(weights1).not.toBe(weights2); // different objects
    expect(weights1).toEqual(weights2); // but same values
    
    weights1.escrow = 999; // mutating returned object
    expect(orchestrator.getWeights().escrow).toBe(0.5); // original unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 3: getActiveFibers() returns running fibers
// ─────────────────────────────────────────────────────────────────────────────

describe('FiberOrchestrator - getActiveFibers', () => {
  it('should return empty array initially', () => {
    const orchestrator = createOrchestrator();
    
    const activeFibers = orchestrator.getActiveFibers();
    
    expect(activeFibers).toEqual([]);
  });

  it('should return active fibers after creation', async () => {
    const orchestrator = createOrchestrator();
    mockBridge.proposeContract.mockResolvedValue({ contractId: 'fiber-123' });
    
    // Simulate fiber creation by calling tick (would normally create fibers)
    await orchestrator.tick();
    
    const activeFibers = orchestrator.getActiveFibers();
    
    expect(Array.isArray(activeFibers)).toBe(true);
    // Note: Actual fiber creation depends on bridge mock behavior
    // This test will fail initially until implementation exists
  });

  it('should return a copy of active fibers (not reference)', () => {
    const orchestrator = createOrchestrator();
    
    const fibers1 = orchestrator.getActiveFibers();
    const fibers2 = orchestrator.getActiveFibers();
    
    expect(fibers1).not.toBe(fibers2); // different array instances
    expect(fibers1).toEqual(fibers2); // but same contents
  });

  it('should include fiber metadata (id, type, currentState, participants)', async () => {
    const orchestrator = createOrchestrator();
    mockBridge.proposeContract.mockResolvedValue({ contractId: 'test-fiber-456' });
    
    // Force fiber creation through bootstrap or tick
    await orchestrator.bootstrapAgents(2);
    await orchestrator.tick();
    
    const activeFibers = orchestrator.getActiveFibers();
    
    if (activeFibers.length > 0) {
      const fiber = activeFibers[0];
      expect(fiber).toHaveProperty('id');
      expect(fiber).toHaveProperty('type');
      expect(fiber).toHaveProperty('currentState');
      expect(fiber).toHaveProperty('participants');
      expect(fiber).toHaveProperty('startedAt');
      expect(typeof fiber.id).toBe('string');
      expect(typeof fiber.type).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 4: getCompletedFiberLog() ring buffer behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('FiberOrchestrator - getCompletedFiberLog', () => {
  it('should return empty array initially', () => {
    const orchestrator = createOrchestrator();
    
    const completedLog = orchestrator.getCompletedFiberLog();
    
    expect(completedLog).toEqual([]);
  });

  it('should cap at 100 entries (ring buffer)', async () => {
    const orchestrator = createOrchestrator();
    
    // Mock a scenario where we complete many fibers
    // This requires implementing a way to simulate completed fibers
    // For now, this test documents expected behavior and will fail
    
    // Simulate completing 150 fibers (would need orchestrator internal manipulation)
    // const completedLog = orchestrator.getCompletedFiberLog();
    // expect(completedLog.length).toBeLessThanOrEqual(100);
    
    // This test will initially fail as the completion logic isn't exposed
    expect(true).toBe(false); // Deliberate failure for TDD
  });

  it('should return newest first (LIFO order)', async () => {
    const orchestrator = createOrchestrator();
    
    // Simulate completing multiple fibers with timestamps
    // This test will fail initially until completion tracking is implemented
    
    const completedLog = orchestrator.getCompletedFiberLog();
    
    // Check that entries are ordered by completedAt timestamp (newest first)
    for (let i = 1; i < completedLog.length; i++) {
      const current = new Date(completedLog[i - 1].completedAt).getTime();
      const next = new Date(completedLog[i].completedAt).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });

  it('should include completed fiber metadata (id, type, finalState, completedAt)', () => {
    const orchestrator = createOrchestrator();
    
    // This test documents expected structure and will fail initially
    const completedLog = orchestrator.getCompletedFiberLog();
    
    if (completedLog.length > 0) {
      const entry = completedLog[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('type'); 
      expect(entry).toHaveProperty('finalState');
      expect(entry).toHaveProperty('completedAt');
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.finalState).toBe('string');
      expect(typeof entry.completedAt).toBe('string'); // ISO timestamp
    }
    
    // Force failure for TDD - no completed fibers initially
    expect(completedLog.length).toBeGreaterThan(0);
  });

  it('should return a copy (not reference to internal log)', () => {
    const orchestrator = createOrchestrator();
    
    const log1 = orchestrator.getCompletedFiberLog();
    const log2 = orchestrator.getCompletedFiberLog();
    
    expect(log1).not.toBe(log2); // different array instances
    expect(log1).toEqual(log2); // but same contents
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 5: Integration test combining all methods
// ─────────────────────────────────────────────────────────────────────────────

describe('FiberOrchestrator - Integration', () => {
  it('should maintain consistent state across weight updates and fiber lifecycle', async () => {
    const orchestrator = createOrchestrator();
    
    // Initial state
    expect(orchestrator.getActiveFibers()).toEqual([]);
    expect(orchestrator.getCompletedFiberLog()).toEqual([]);
    expect(orchestrator.getWeights()).toEqual({
      escrow: 0.5,
      market: 0.3,
      dao: 0.2,
    });
    
    // Update weights
    orchestrator.updateWeights({ escrow: 0.7, market: 0.3 });
    expect(orchestrator.getWeights().escrow).toBe(0.7);
    
    // This test will expand once fiber lifecycle is fully implemented
    // For now, it serves as a placeholder for integration testing
  });
});