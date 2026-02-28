/**
 * Status Server Type Safety Tests
 *
 * Regression test for #177: FibersProvider and AgentsProvider used `unknown[]`
 * instead of properly typed interfaces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setFibersProvider,
  setAgentsProvider,
  startStatusServer,
  stopStatusServer,
  type ActiveFiberStatus,
  type CompletedFiberStatus,
  type FibersResponse,
  type AgentsResponse,
} from '../status-server.js';

const TEST_PORT = 3099;

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`http://localhost:${TEST_PORT}${path}`);
  return res.json();
}

describe('status-server: fiber/agent type safety (issue #177)', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('ActiveFiberStatus has all required fields', () => {
    const fiber: ActiveFiberStatus = {
      id: 'fiber-1',
      type: 'contract',
      currentState: 'PROPOSED',
      participants: ['DAG123', 'DAG456'],
      startedAt: Date.now(),
      pending: false,
    };
    expect(fiber.id).toBe('fiber-1');
    expect(typeof fiber.startedAt).toBe('number');
    expect(Array.isArray(fiber.participants)).toBe(true);
  });

  it('CompletedFiberStatus has all required fields', () => {
    const entry: CompletedFiberStatus = {
      id: 'fiber-2',
      type: 'market',
      finalState: 'RESOLVED',
      completedAt: new Date().toISOString(),
    };
    expect(entry.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('GET /fibers returns FibersResponse shape', async () => {
    const mockResponse: FibersResponse = {
      active: [{ id: 'f1', type: 'dao', currentState: 'VOTING', participants: ['DAGabc'], startedAt: 1000000, pending: true }],
      completed: [{ id: 'f0', type: 'contract', finalState: 'EXECUTED', completedAt: '2026-02-28T00:00:00Z' }],
      failed: 2,
    };
    setFibersProvider(() => mockResponse);
    const data = (await fetchJson('/fibers')) as FibersResponse;
    expect(Array.isArray(data.active)).toBe(true);
    expect(Array.isArray(data.completed)).toBe(true);
    expect(data.active[0].id).toBe('f1');
    expect(data.active[0].currentState).toBe('VOTING');
    expect(typeof data.active[0].startedAt).toBe('number');
    expect(typeof data.active[0].pending).toBe('boolean');
    expect(data.completed[0].finalState).toBe('EXECUTED');
    expect(data.failed).toBe(2);
  });

  it('GET /agents returns AgentsResponse shape', async () => {
    const mockResponse: AgentsResponse = { registered: ['DAGagent1', 'DAGagent2'], count: 2 };
    setAgentsProvider(() => mockResponse);
    const data = (await fetchJson('/agents')) as AgentsResponse;
    expect(Array.isArray(data.registered)).toBe(true);
    expect(data.count).toBe(2);
    expect(data.registered).toContain('DAGagent1');
  });
});
