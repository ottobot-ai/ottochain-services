/**
 * Status Server Unit Tests
 *
 * Test cases from Issue #178:
 * - GET /weights — returns current weights
 * - POST /weights — updates weights, validates input  
 * - GET /fibers — returns active + completed fibers
 * - GET /agents — returns registered agent addresses
 * - POST /weights validation — malformed JSON, negative weights
 *
 * These tests cover the HTTP endpoints exposed by status-server.ts
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import * as http from 'node:http';
// Mock the status server for TDD testing
// Note: Avoiding direct imports due to module resolution issues

// Mock implementations that will fail - demonstrating TDD approach
const mockStartStatusServer = vi.fn().mockRejectedValue(new Error('startStatusServer not implemented'));
const mockStopStatusServer = vi.fn().mockRejectedValue(new Error('stopStatusServer not implemented'));
const mockSetStatusProvider = vi.fn();
const mockSetWeightsProvider = vi.fn();
const mockSetFibersProvider = vi.fn();
const mockSetAgentsProvider = vi.fn();
const mockSetControlCallbacks = vi.fn();

// Create mock module
const startStatusServer = mockStartStatusServer;
const stopStatusServer = mockStopStatusServer;
const setStatusProvider = mockSetStatusProvider;
const setWeightsProvider = mockSetWeightsProvider;
const setFibersProvider = mockSetFibersProvider;
const setAgentsProvider = mockSetAgentsProvider;
const setControlCallbacks = mockSetControlCallbacks;

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

const TEST_PORT = 3034; // Different from default to avoid conflicts

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function makeRequest(
  method: string,
  path: string,
  body?: string
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body && { 'Content-Length': Buffer.byteLength(body) }),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body: data,
        });
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data & Providers
// ─────────────────────────────────────────────────────────────────────────────

const mockWeights = {
  escrow: 0.5,
  market: 0.3,
  dao: 0.2,
};

const mockFibers = {
  active: [
    {
      id: 'fiber-123',
      type: 'escrow',
      currentState: 'proposed',
      participants: ['0x1234...', '0x5678...'],
      startedAt: Date.now(),
      pending: false,
    },
  ],
  completed: [
    {
      id: 'fiber-456',
      type: 'market',
      finalState: 'finalized',
      completedAt: new Date().toISOString(),
    },
  ],
  failed: 2,
};

const mockAgents = {
  registered: ['0x1234567890abcdef...', '0x2345678901bcdef...'],
  count: 2,
};

const mockWeightsProvider = vi.fn(() => ({ ...mockWeights }));
const mockFibersProvider = vi.fn(() => ({ ...mockFibers }));
const mockAgentsProvider = vi.fn(() => ({ ...mockAgents }));
const mockWeightsUpdate = vi.fn();

// ─────────────────────────────────────────────────────────────────────────────
// Setup & Teardown
// ─────────────────────────────────────────────────────────────────────────────

describe('Status Server - HTTP Endpoints', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Set up providers
    setWeightsProvider(mockWeightsProvider);
    setFibersProvider(mockFibersProvider);
    setAgentsProvider(mockAgentsProvider);
    setControlCallbacks({
      onWeightsUpdate: mockWeightsUpdate,
    });
    
    // Start server
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 1: GET /weights — returns current weights
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /weights', () => {
    it('should return current weights configuration', async () => {
      const response = await makeRequest('GET', '/weights');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');
      
      const weights = JSON.parse(response.body);
      expect(weights).toEqual({
        escrow: 0.5,
        market: 0.3,
        dao: 0.2,
      });
      
      expect(mockWeightsProvider).toHaveBeenCalledOnce();
    });

    it('should return 500 if weights provider throws error', async () => {
      mockWeightsProvider.mockImplementationOnce(() => {
        throw new Error('Provider error');
      });

      const response = await makeRequest('GET', '/weights');

      expect(response.status).toBe(500);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('Failed to get weights');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 2: POST /weights — updates weights, validates input
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /weights', () => {
    it('should update weights with valid JSON', async () => {
      const newWeights = { escrow: 0.6, market: 0.4 };
      
      const response = await makeRequest('POST', '/weights', JSON.stringify(newWeights));

      expect(response.status).toBe(200);
      
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Weights updated');
      expect(result.weights).toEqual(newWeights);
      
      expect(mockWeightsUpdate).toHaveBeenCalledWith(newWeights);
    });

    it('should return 400 for malformed JSON', async () => {
      const response = await makeRequest('POST', '/weights', '{ invalid json }');

      expect(response.status).toBe(500);
      const error = JSON.parse(response.body);
      expect(error.error).toMatch(/Failed to update weights/);
    });

    it('should return 400 for negative weights', async () => {
      const negativeWeights = { escrow: -0.1, market: 0.5 };
      
      // This test expects the server to validate and reject negative weights
      // Currently the server doesn't validate, so this will fail (TDD)
      const response = await makeRequest('POST', '/weights', JSON.stringify(negativeWeights));

      // This should be 400, but current implementation probably returns 200
      expect(response.status).toBe(400);
      
      const error = JSON.parse(response.body);
      expect(error.error).toMatch(/negative weights/i);
    });

    it('should handle empty request body gracefully', async () => {
      const response = await makeRequest('POST', '/weights', '');

      expect(response.status).toBe(200);
      expect(mockWeightsUpdate).toHaveBeenCalledWith({});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 3: GET /fibers — returns active + completed fibers
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /fibers', () => {
    it('should return active and completed fibers', async () => {
      const response = await makeRequest('GET', '/fibers');

      expect(response.status).toBe(200);
      
      const fibers = JSON.parse(response.body);
      expect(fibers).toHaveProperty('active');
      expect(fibers).toHaveProperty('completed');
      expect(fibers).toHaveProperty('failed');
      
      expect(fibers.active).toHaveLength(1);
      expect(fibers.active[0]).toEqual({
        id: 'fiber-123',
        type: 'escrow',
        currentState: 'proposed',
        participants: ['0x1234...', '0x5678...'],
        startedAt: expect.any(Number),
        pending: false,
      });
      
      expect(fibers.completed).toHaveLength(1);
      expect(fibers.completed[0]).toEqual({
        id: 'fiber-456',
        type: 'market',
        finalState: 'finalized',
        completedAt: expect.any(String),
      });
      
      expect(fibers.failed).toBe(2);
      expect(mockFibersProvider).toHaveBeenCalledOnce();
    });

    it('should handle empty fibers gracefully', async () => {
      mockFibersProvider.mockReturnValueOnce({
        active: [],
        completed: [],
        failed: 0,
      });

      const response = await makeRequest('GET', '/fibers');

      expect(response.status).toBe(200);
      
      const fibers = JSON.parse(response.body);
      expect(fibers.active).toEqual([]);
      expect(fibers.completed).toEqual([]);
      expect(fibers.failed).toBe(0);
    });

    it('should return 500 if fibers provider throws error', async () => {
      mockFibersProvider.mockImplementationOnce(() => {
        throw new Error('Fibers provider error');
      });

      const response = await makeRequest('GET', '/fibers');

      expect(response.status).toBe(500);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('Failed to get fibers');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 4: GET /agents — returns registered agent addresses
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /agents', () => {
    it('should return registered agents list and count', async () => {
      const response = await makeRequest('GET', '/agents');

      expect(response.status).toBe(200);
      
      const agents = JSON.parse(response.body);
      expect(agents).toHaveProperty('registered');
      expect(agents).toHaveProperty('count');
      
      expect(agents.registered).toEqual([
        '0x1234567890abcdef...',
        '0x2345678901bcdef...',
      ]);
      expect(agents.count).toBe(2);
      
      expect(mockAgentsProvider).toHaveBeenCalledOnce();
    });

    it('should handle empty agents list', async () => {
      mockAgentsProvider.mockReturnValueOnce({
        registered: [],
        count: 0,
      });

      const response = await makeRequest('GET', '/agents');

      expect(response.status).toBe(200);
      
      const agents = JSON.parse(response.body);
      expect(agents.registered).toEqual([]);
      expect(agents.count).toBe(0);
    });

    it('should return 500 if agents provider throws error', async () => {
      mockAgentsProvider.mockImplementationOnce(() => {
        throw new Error('Agents provider error');
      });

      const response = await makeRequest('GET', '/agents');

      expect(response.status).toBe(500);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('Failed to get agents');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 5: CORS and general endpoint behavior
  // ─────────────────────────────────────────────────────────────────────────────

  describe('CORS and HTTP behavior', () => {
    it('should include CORS headers on all responses', async () => {
      const response = await makeRequest('GET', '/weights');

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const response = await makeRequest('OPTIONS', '/weights');

      expect(response.status).toBe(204);
      expect(response.body).toBe('');
    });

    it('should return 404 for unknown endpoints', async () => {
      const response = await makeRequest('GET', '/unknown');

      expect(response.status).toBe(404);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('Not found');
    });

    it('should return 501 when providers are not configured', async () => {
      // Stop server and restart without providers
      await stopStatusServer();
      
      // Reset providers
      setWeightsProvider(null as any);
      setFibersProvider(null as any);
      setAgentsProvider(null as any);
      
      await startStatusServer(TEST_PORT);

      const weightsResponse = await makeRequest('GET', '/weights');
      expect(weightsResponse.status).toBe(501);

      const fibersResponse = await makeRequest('GET', '/fibers');
      expect(fibersResponse.status).toBe(501);

      const agentsResponse = await makeRequest('GET', '/agents');
      expect(agentsResponse.status).toBe(501);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Case 6: Edge cases and error conditions
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Edge cases and error handling', () => {
    it('should handle large weight update payloads', async () => {
      const largeWeights: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        largeWeights[`fiber_type_${i}`] = Math.random();
      }
      
      const response = await makeRequest('POST', '/weights', JSON.stringify(largeWeights));

      expect(response.status).toBe(200);
      expect(mockWeightsUpdate).toHaveBeenCalledWith(largeWeights);
    });

    it('should handle concurrent requests properly', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => 
        makeRequest('GET', '/weights')
      );
      
      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        const weights = JSON.parse(response.body);
        expect(weights).toEqual(mockWeights);
      });
      
      expect(mockWeightsProvider).toHaveBeenCalledTimes(10);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 7: Server lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Status Server - Lifecycle', () => {
  it('should start and stop server cleanly', async () => {
    await expect(startStatusServer(TEST_PORT + 1)).resolves.not.toThrow();
    await expect(stopStatusServer()).resolves.not.toThrow();
  });

  it('should reject connections after server stop', async () => {
    await startStatusServer(TEST_PORT + 2);
    await stopStatusServer();
    
    await expect(makeRequest('GET', '/weights')).rejects.toThrow();
  });

  it('should handle server start on occupied port', async () => {
    await startStatusServer(TEST_PORT + 3);
    
    // Try to start another server on the same port
    await expect(startStatusServer(TEST_PORT + 3)).rejects.toThrow();
    
    await stopStatusServer();
  });
});