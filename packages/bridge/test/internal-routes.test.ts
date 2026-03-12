/**
 * Unit tests for /internal bridge routes
 *
 * Tests the indexer-notify endpoint and pending-confirmations diagnostic endpoint.
 *
 * Run: node --test --experimental-strip-types test/internal-routes.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Router } from 'express';
import { ConfirmationRegistry } from '../src/lib/confirmation-registry.ts';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Build a minimal test app with internal routes backed by a custom registry
// ─────────────────────────────────────────────────────────────────────────────

function buildApp(registry: ConfirmationRegistry): http.Server {
  const router = Router();

  const FiberSchema = z.object({
    fiberId: z.string().uuid(),
    currentState: z.string(),
    ordinal: z.number().int().nonnegative(),
    status: z.string(),
  });

  const BodySchema = z.object({
    snapshotOrdinal: z.number().int().nonnegative(),
    fibers: z.array(FiberSchema).min(1),
  });

  router.post('/indexer-notify', (req, res) => {
    const parse = BodySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() });
      return;
    }
    const { snapshotOrdinal, fibers } = parse.data;
    let resolved = 0;
    for (const f of fibers) {
      if (registry.notify(f)) resolved++;
    }
    res.json({
      accepted: true,
      snapshotOrdinal,
      fibersReceived: fibers.length,
      waiterssResolved: resolved,
      pendingWaiters: registry.size,
    });
  });

  router.get('/pending-confirmations', (_req, res) => {
    res.json({ count: registry.size, pending: registry.pendingIds() });
  });

  const app = express();
  app.use(express.json());
  app.use('/internal', router);

  return http.createServer(app);
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal HTTP helper (no supertest required)
// ─────────────────────────────────────────────────────────────────────────────

interface TestResponse {
  status: number;
  body: Record<string, unknown>;
}

async function post(server: http.Server, path: string, body: unknown): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function get(server: http.Server, path: string): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/indexer-notify
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /internal/indexer-notify', () => {
  let registry: ConfirmationRegistry;
  let server: http.Server;

  before(async () => {
    registry = new ConfirmationRegistry();
    server = buildApp(registry);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  after(async () => {
    await new Promise<void>((r, e) => server.close(err => err ? e(err) : r()));
  });

  it('returns 400 for empty body', async () => {
    const res = await post(server, '/internal/indexer-notify', {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid payload');
  });

  it('returns 400 when fibers array is empty', async () => {
    const res = await post(server, '/internal/indexer-notify', { snapshotOrdinal: 1, fibers: [] });
    assert.equal(res.status, 400);
  });

  it('returns 400 for invalid fiberId (not UUID)', async () => {
    const res = await post(server, '/internal/indexer-notify', {
      snapshotOrdinal: 1,
      fibers: [{ fiberId: 'not-a-uuid', currentState: 'ACTIVE', ordinal: 1, status: 'ACTIVE' }],
    });
    assert.equal(res.status, 400);
  });

  it('resolves 0 waiters when no one is registered', async () => {
    const res = await post(server, '/internal/indexer-notify', {
      snapshotOrdinal: 10,
      fibers: [{ fiberId: 'aaaaaaaa-0000-0000-0000-000000000001', currentState: 'ACTIVE', ordinal: 10, status: 'ACTIVE' }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.accepted, true);
    assert.equal(res.body.fibersReceived, 1);
    assert.equal(res.body.waiterssResolved, 0);
    assert.equal(res.body.pendingWaiters, 0);
  });

  it('resolves a registered waiter', async () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000011';
    const waitPromise = registry.register(fiberId, 5_000);

    const res = await post(server, '/internal/indexer-notify', {
      snapshotOrdinal: 20,
      fibers: [{ fiberId, currentState: 'COMPLETED', ordinal: 20, status: 'ARCHIVED' }],
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.waiterssResolved, 1);

    const conf = await waitPromise;
    assert.equal(conf.fiberId, fiberId);
    assert.equal(conf.currentState, 'COMPLETED');
    assert.equal(conf.ordinal, 20);
  });

  it('resolves multiple waiters in a single call', async () => {
    const ids = [
      'aaaaaaaa-0000-0000-0000-000000000021',
      'aaaaaaaa-0000-0000-0000-000000000022',
    ];
    const promises = ids.map(id => registry.register(id, 5_000));

    const res = await post(server, '/internal/indexer-notify', {
      snapshotOrdinal: 30,
      fibers: ids.map(fiberId => ({ fiberId, currentState: 'ACTIVE', ordinal: 30, status: 'ACTIVE' })),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.waiterssResolved, 2);

    await Promise.all(promises);
    assert.equal(registry.size, 0);
  });

  it('handles a mix of registered and unregistered fibers', async () => {
    const registeredId = 'aaaaaaaa-0000-0000-0000-000000000031';
    const unregisteredId = 'aaaaaaaa-0000-0000-0000-000000000032';

    registry.register(registeredId, 5_000);

    const res = await post(server, '/internal/indexer-notify', {
      snapshotOrdinal: 40,
      fibers: [
        { fiberId: registeredId, currentState: 'ACTIVE', ordinal: 40, status: 'ACTIVE' },
        { fiberId: unregisteredId, currentState: 'ACTIVE', ordinal: 40, status: 'ACTIVE' },
      ],
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.fibersReceived, 2);
    assert.equal(res.body.waiterssResolved, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /internal/pending-confirmations
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /internal/pending-confirmations', () => {
  let registry: ConfirmationRegistry;
  let server: http.Server;

  before(async () => {
    registry = new ConfirmationRegistry();
    server = buildApp(registry);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  after(async () => {
    await new Promise<void>((r, e) => server.close(err => err ? e(err) : r()));
  });

  it('returns empty list when no waiters', async () => {
    const res = await get(server, '/internal/pending-confirmations');
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 0);
    assert.deepEqual(res.body.pending, []);
  });

  it('lists pending fiber IDs', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000041';
    registry.register(id, 5_000);

    const res = await get(server, '/internal/pending-confirmations');
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.ok((res.body.pending as string[]).includes(id));

    // Cleanup
    registry.cancel(id);
  });
});
