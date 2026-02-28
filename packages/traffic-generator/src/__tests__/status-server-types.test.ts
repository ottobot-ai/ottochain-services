/**
 * Regression test for issue #177: status-server provider types
 *
 * Verifies that FibersProvider and AgentsProvider use properly typed
 * interfaces instead of unknown[].
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
import http from 'node:http';

const TEST_PORT = 3099;

async function getJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

describe('status-server provider types (issue #177)', () => {
  beforeEach(async () => {
    await startStatusServer(TEST_PORT);
  });

  afterEach(async () => {
    await stopStatusServer();
  });

  it('FibersResponse interface has correct shape', () => {
    const active: ActiveFiberStatus = {
      id: 'fiber-1',
      type: 'market',
      currentState: 'OPEN',
      participants: ['DAG123', 'DAG456'],
      startedAt: Date.now(),
      pending: false,
    };
    const completed: CompletedFiberStatus = {
      id: 'fiber-0',
      type: 'market',
      finalState: 'RESOLVED',
      completedAt: new Date().toISOString(),
    };
    const response: FibersResponse = {
      active: [active],
      completed: [completed],
      failed: 0,
    };
    expect(response.active[0].id).toBe('fiber-1');
    expect(response.completed[0].finalState).toBe('RESOLVED');
    expect(response.failed).toBe(0);
  });

  it('AgentsResponse interface has correct shape', () => {
    const response: AgentsResponse = {
      registered: ['DAG123', 'DAG456'],
      count: 2,
    };
    expect(response.registered).toHaveLength(2);
    expect(response.count).toBe(2);
  });

  it('GET /fibers returns typed FibersResponse via provider', async () => {
    const mockFibers: FibersResponse = {
      active: [
        {
          id: 'f1',
          type: 'dao',
          currentState: 'VOTING',
          participants: ['DAGabc'],
          startedAt: 1000000,
          pending: true,
        },
      ],
      completed: [],
      failed: 2,
    };
    setFibersProvider(() => mockFibers);

    const result = await getJson('/fibers') as FibersResponse;
    expect(result.active).toHaveLength(1);
    expect((result.active[0] as ActiveFiberStatus).id).toBe('f1');
    expect((result.active[0] as ActiveFiberStatus).pending).toBe(true);
    expect(result.failed).toBe(2);
  });

  it('GET /agents returns typed AgentsResponse via provider', async () => {
    const mockAgents: AgentsResponse = {
      registered: ['DAG001', 'DAG002', 'DAG003'],
      count: 3,
    };
    setAgentsProvider(() => mockAgents);

    const result = await getJson('/agents') as AgentsResponse;
    expect(result.registered).toEqual(['DAG001', 'DAG002', 'DAG003']);
    expect(result.count).toBe(3);
  });
});
