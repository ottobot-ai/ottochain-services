/**
 * Unit tests for ConfirmationRegistry
 *
 * Tests push-based fiber confirmation registry used for indexer → bridge callbacks.
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { ConfirmationRegistry } from '../src/lib/confirmation-registry.ts';
import type { FiberConfirmation } from '../src/lib/confirmation-registry.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConf(fiberId: string, ordinal = 42): FiberConfirmation {
  return { fiberId, currentState: 'ACTIVE', ordinal, status: 'ACTIVE' };
}

// ─────────────────────────────────────────────────────────────────────────────
// register + notify
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfirmationRegistry — register + notify', () => {
  let registry: ConfirmationRegistry;

  beforeEach(() => {
    registry = new ConfirmationRegistry();
  });

  it('resolves a registered waiter when notify() is called', async () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const promise = registry.register(fiberId, 5_000);

    const conf = makeConf(fiberId);
    const resolved = registry.notify(conf);

    expect(resolved).toBe(true);
    const result = await promise;
    expect(result).toEqual(conf);
  });

  it('returns false from notify() when no waiter is registered', () => {
    const resolved = registry.notify(makeConf('aaaaaaaa-0000-0000-0000-000000000002'));
    expect(resolved).toBe(false);
  });

  it('resolves with the exact confirmation payload', async () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000003';
    const conf: FiberConfirmation = {
      fiberId,
      currentState: 'COMPLETED',
      ordinal: 99,
      status: 'ARCHIVED',
    };
    const promise = registry.register(fiberId, 5_000);
    registry.notify(conf);

    const result = await promise;
    expect(result).toEqual(conf);
  });

  it('notifying an already-resolved fiber returns false', async () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000004';
    const promise = registry.register(fiberId, 5_000);
    registry.notify(makeConf(fiberId));
    await promise;

    // Second notify — waiter is gone
    const resolved = registry.notify(makeConf(fiberId));
    expect(resolved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// size + pendingIds
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfirmationRegistry — size + pendingIds', () => {
  let registry: ConfirmationRegistry;

  beforeEach(() => {
    registry = new ConfirmationRegistry();
  });

  it('starts at size 0', () => {
    expect(registry.size).toBe(0);
  });

  it('tracks size correctly across register/notify', async () => {
    const id1 = 'aaaaaaaa-0000-0000-0000-000000000011';
    const id2 = 'aaaaaaaa-0000-0000-0000-000000000012';

    const p1 = registry.register(id1, 5_000);
    expect(registry.size).toBe(1);

    const p2 = registry.register(id2, 5_000);
    expect(registry.size).toBe(2);

    registry.notify(makeConf(id1));
    await p1;
    expect(registry.size).toBe(1);

    registry.notify(makeConf(id2));
    await p2;
    expect(registry.size).toBe(0);
  });

  it('lists pending fiber IDs', () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000021';
    registry.register(id, 5_000);
    expect(registry.pendingIds().includes(id)).toBe(true);
  });

  it('removes ID from pendingIds after resolution', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000022';
    const p = registry.register(id, 5_000);
    registry.notify(makeConf(id));
    await p;
    expect(registry.pendingIds().includes(id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// timeout
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfirmationRegistry — timeout', () => {
  it('rejects after timeoutMs elapses', { timeout: 5000 }, async () => {
    const registry = new ConfirmationRegistry();
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000031';

    const promise = registry.register(fiberId, 100); // 100ms — real timer

    await expect(promise).rejects.toThrow(/timeout/i);

    expect(registry.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cancel
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfirmationRegistry — cancel', () => {
  let registry: ConfirmationRegistry;

  beforeEach(() => {
    registry = new ConfirmationRegistry();
  });

  it('cancel() removes the waiter', () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000041';
    const p = registry.register(fiberId, 5_000);
    // Attach a no-op catch so the dangling promise doesn't cause unhandled rejection
    p.catch(() => {});
    expect(registry.size).toBe(1);

    registry.cancel(fiberId);
    expect(registry.size).toBe(0);
  });

  it('subsequent notify returns false after cancel', () => {
    const fiberId = 'aaaaaaaa-0000-0000-0000-000000000042';
    const p = registry.register(fiberId, 5_000);
    p.catch(() => {});
    registry.cancel(fiberId);
    expect(registry.notify(makeConf(fiberId))).toBe(false);
  });

  it('cancel() is safe to call when fiberId not registered', () => {
    expect(() => registry.cancel('aaaaaaaa-0000-0000-0000-deadbeef0000')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// multiple fibers
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfirmationRegistry — multiple concurrent waiters', () => {
  it('handles multiple fibers independently', async () => {
    const registry = new ConfirmationRegistry();
    const ids = [
      'aaaaaaaa-0000-0000-0000-000000000061',
      'aaaaaaaa-0000-0000-0000-000000000062',
      'aaaaaaaa-0000-0000-0000-000000000063',
    ];

    const promises = ids.map(id => registry.register(id, 5_000));

    // Notify in reverse order
    registry.notify(makeConf(ids[2], 3));
    registry.notify(makeConf(ids[0], 1));
    registry.notify(makeConf(ids[1], 2));

    const results = await Promise.all(promises);
    expect(results[0].ordinal).toBe(1);
    expect(results[1].ordinal).toBe(2);
    expect(results[2].ordinal).toBe(3);
    expect(registry.size).toBe(0);
  });
});
