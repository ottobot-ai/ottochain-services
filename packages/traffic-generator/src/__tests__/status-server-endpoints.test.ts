/**
 * Status Server Endpoint Tests — Issue #178
 *
 * Tests for GET /weights, POST /weights, GET /fibers, and GET /agents
 * including input validation, error handling, and happy-path responses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setStatusProvider,
  setWeightsProvider,
  setFibersProvider,
  setAgentsProvider,
  setControlCallbacks,
  startStatusServer,
  stopStatusServer,
  type TrafficGenStatus,
  type FibersResponse,
  type AgentsResponse,
} from '../status-server.js';

const TEST_PORT = 3098;
const BASE = `http://localhost:${TEST_PORT}`;

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function post(
  path: string,
  body: unknown,
  contentType = 'application/json'
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const mockStatus: TrafficGenStatus = {
  enabled: true,
  mode: 'orchestrator',
  targetActiveFibers: 5,
  activeFibers: 3,
  completedFibers: 10,
  failedFibers: 1,
  successRate: 0.91,
  fiberTypeDistribution: { escrow: 2, ticTacToe: 1 },
  uptime: 60000,
  startedAt: '2026-01-01T00:00:00.000Z',
};

const mockWeights: Record<string, number> = {
  escrow: 30,
  ticTacToe: 30,
  simpleOrder: 20,
  voting: 20,
};

const mockFibersResponse: FibersResponse = {
  active: [
    { id: 'f1', type: 'escrow', currentState: 'PROPOSED', participants: ['DAG001', 'DAG002'], startedAt: 1000000, pending: false },
    { id: 'f2', type: 'ticTacToe', currentState: 'IN_PROGRESS', participants: ['DAG003', 'DAG004'], startedAt: 1100000, pending: true },
  ],
  completed: [
    { id: 'f0', type: 'escrow', finalState: 'COMPLETED', completedAt: '2026-01-01T00:01:00Z' },
  ],
  failed: 1,
};

const mockAgentsResponse: AgentsResponse = {
  registered: ['DAG001', 'DAG002', 'DAG003'],
  count: 3,
};

describe('status-server: GET /weights', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('should return 501 when weightsProvider not configured', async () => {
    // Provider not set in this test
    const { status, body } = await get('/weights');
    expect(status).toBe(501);
    expect((body as { error: string }).error).toMatch(/not configured/i);
  });

  it('should return 200 with current weights', async () => {
    setWeightsProvider(() => mockWeights);
    const { status, body } = await get('/weights');
    expect(status).toBe(200);
    expect(body).toEqual(mockWeights);
  });

  it('should return the exact weights object provided', async () => {
    const customWeights = { market: 50, dao: 50 };
    setWeightsProvider(() => customWeights);
    const { status, body } = await get('/weights');
    expect(status).toBe(200);
    expect((body as Record<string, number>).market).toBe(50);
    expect((body as Record<string, number>).dao).toBe(50);
  });
});

describe('status-server: POST /weights', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('should return 501 when onWeightsUpdate not configured', async () => {
    const { status, body } = await post('/weights', { escrow: 50 });
    expect(status).toBe(501);
    expect((body as { error: string }).error).toMatch(/not implemented/i);
  });

  it('should return 400 for malformed JSON', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status, body } = await post('/weights', 'this is not json', 'application/json');
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/invalid json/i);
    expect(onWeightsUpdate).not.toHaveBeenCalled();
  });

  it('should return 400 for negative weights', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status, body } = await post('/weights', { escrow: -5, ticTacToe: 50 });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/non-negative/i);
    expect(onWeightsUpdate).not.toHaveBeenCalled();
  });

  it('should return 400 if any weight is negative even when others are valid', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status } = await post('/weights', { escrow: 50, ticTacToe: -0.01 });
    expect(status).toBe(400);
    expect(onWeightsUpdate).not.toHaveBeenCalled();
  });

  it('should return 400 for non-numeric weight values', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status, body } = await post('/weights', { escrow: 'high', ticTacToe: 50 });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/non-negative/i);
  });

  it('should return 200 with updated weights on success', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const newWeights = { escrow: 40, ticTacToe: 60 };
    const { status, body } = await post('/weights', newWeights);
    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
    expect((body as { weights: Record<string, number> }).weights).toEqual(newWeights);
    expect(onWeightsUpdate).toHaveBeenCalledWith(newWeights);
  });

  it('should accept zero weight values (disabling a fiber type)', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status } = await post('/weights', { escrow: 0, ticTacToe: 100 });
    expect(status).toBe(200);
    expect(onWeightsUpdate).toHaveBeenCalledWith({ escrow: 0, ticTacToe: 100 });
  });

  it('should return 400 for array body (not an object)', async () => {
    const onWeightsUpdate = vi.fn();
    setControlCallbacks({ onWeightsUpdate });

    const { status } = await post('/weights', [50, 50]);
    expect(status).toBe(400);
    expect(onWeightsUpdate).not.toHaveBeenCalled();
  });
});

describe('status-server: GET /fibers', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('should return 501 when fibersProvider not configured', async () => {
    const { status, body } = await get('/fibers');
    expect(status).toBe(501);
    expect((body as { error: string }).error).toMatch(/not configured/i);
  });

  it('should return 200 with active and completed fibers', async () => {
    setFibersProvider(() => mockFibersResponse);
    const { status, body } = await get('/fibers');
    expect(status).toBe(200);
    const data = body as FibersResponse;
    expect(Array.isArray(data.active)).toBe(true);
    expect(Array.isArray(data.completed)).toBe(true);
  });

  it('should include all active fiber fields', async () => {
    setFibersProvider(() => mockFibersResponse);
    const { body } = await get('/fibers');
    const data = body as FibersResponse;
    const fiber = data.active[0];
    expect(typeof fiber.id).toBe('string');
    expect(typeof fiber.type).toBe('string');
    expect(typeof fiber.currentState).toBe('string');
    expect(Array.isArray(fiber.participants)).toBe(true);
    expect(typeof fiber.startedAt).toBe('number');
    expect(typeof fiber.pending).toBe('boolean');
  });

  it('should include all completed fiber fields', async () => {
    setFibersProvider(() => mockFibersResponse);
    const { body } = await get('/fibers');
    const data = body as FibersResponse;
    const entry = data.completed[0];
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.type).toBe('string');
    expect(typeof entry.finalState).toBe('string');
    expect(typeof entry.completedAt).toBe('string');
  });

  it('should include failed count', async () => {
    setFibersProvider(() => mockFibersResponse);
    const { body } = await get('/fibers');
    const data = body as FibersResponse;
    expect(typeof data.failed).toBe('number');
    expect(data.failed).toBe(1);
  });

  it('should return the pending flag correctly', async () => {
    setFibersProvider(() => mockFibersResponse);
    const { body } = await get('/fibers');
    const data = body as FibersResponse;
    expect(data.active[0].pending).toBe(false);
    expect(data.active[1].pending).toBe(true);
  });
});

describe('status-server: GET /agents', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('should return 501 when agentsProvider not configured', async () => {
    const { status, body } = await get('/agents');
    expect(status).toBe(501);
    expect((body as { error: string }).error).toMatch(/not configured/i);
  });

  it('should return 200 with registered agents', async () => {
    setAgentsProvider(() => mockAgentsResponse);
    const { status, body } = await get('/agents');
    expect(status).toBe(200);
    const data = body as AgentsResponse;
    expect(Array.isArray(data.registered)).toBe(true);
    expect(typeof data.count).toBe('number');
  });

  it('should return correct agent addresses', async () => {
    setAgentsProvider(() => mockAgentsResponse);
    const { body } = await get('/agents');
    const data = body as AgentsResponse;
    expect(data.registered).toContain('DAG001');
    expect(data.registered).toContain('DAG002');
    expect(data.registered).toContain('DAG003');
  });

  it('should return count matching registered array length', async () => {
    setAgentsProvider(() => mockAgentsResponse);
    const { body } = await get('/agents');
    const data = body as AgentsResponse;
    expect(data.count).toBe(data.registered.length);
  });

  it('should handle empty agent pool', async () => {
    setAgentsProvider(() => ({ registered: [], count: 0 }));
    const { status, body } = await get('/agents');
    expect(status).toBe(200);
    const data = body as AgentsResponse;
    expect(data.registered).toEqual([]);
    expect(data.count).toBe(0);
  });
});

describe('status-server: GET /status (regression)', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('should return 200 with status object', async () => {
    setStatusProvider(() => mockStatus);
    const { status, body } = await get('/status');
    expect(status).toBe(200);
    const data = body as TrafficGenStatus;
    expect(data.enabled).toBe(true);
    expect(data.mode).toBe('orchestrator');
    expect(data.activeFibers).toBe(3);
  });
});
