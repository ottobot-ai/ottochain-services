/**
 * Internal Bridge Routes
 *
 * These endpoints are NOT meant to be exposed publicly.  They are called
 * service-to-service (indexer → bridge) to deliver push-based notifications.
 *
 * In production, firewall or reverse-proxy rules should block external
 * access to /internal/*.
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { confirmationRegistry } from '../lib/confirmation-registry.js';

export const internalRoutes: RouterType = Router();

// ── Request schema ────────────────────────────────────────────────────────────

const FiberNotificationSchema = z.object({
  fiberId: z.string().uuid(),
  currentState: z.string(),
  ordinal: z.number().int().nonnegative(),
  status: z.string(),
});

const IndexerNotifySchema = z.object({
  /** Snapshot ordinal that triggered this notification. */
  snapshotOrdinal: z.number().int().nonnegative(),
  /** All fibers that were created or updated in this snapshot. */
  fibers: z.array(FiberNotificationSchema).min(1),
});

// ── POST /internal/indexer-notify ────────────────────────────────────────────

/**
 * Called by the indexer after it processes an ML0 snapshot.
 *
 * Body: { snapshotOrdinal: number, fibers: [{ fiberId, currentState, ordinal, status }] }
 *
 * For each fiber in the payload the registry is notified.  Callers that
 * are awaiting `waitForFiberConfirmation(fiberId)` will be resolved immediately.
 *
 * Returns the count of fibers that had active waiters.
 */
internalRoutes.post('/indexer-notify', (req, res) => {
  const parseResult = IndexerNotifySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid payload', details: parseResult.error.flatten() });
    return;
  }

  const { snapshotOrdinal, fibers } = parseResult.data;

  let resolved = 0;
  for (const fiber of fibers) {
    const wasWaiting = confirmationRegistry.notify({
      fiberId: fiber.fiberId,
      currentState: fiber.currentState,
      ordinal: fiber.ordinal,
      status: fiber.status,
    });
    if (wasWaiting) resolved++;
  }

  console.log(
    `[bridge/internal] indexer-notify: ordinal=${snapshotOrdinal}, ` +
    `fibers=${fibers.length}, resolved=${resolved} waiters, ` +
    `pending=${confirmationRegistry.size}`
  );

  res.json({
    accepted: true,
    snapshotOrdinal,
    fibersReceived: fibers.length,
    waiterssResolved: resolved,
    pendingWaiters: confirmationRegistry.size,
  });
});

// ── GET /internal/pending-confirmations ──────────────────────────────────────

/**
 * Diagnostic endpoint: lists fiber IDs currently awaiting push confirmation.
 * Useful for debugging stalls and monitoring.
 */
internalRoutes.get('/pending-confirmations', (_req, res) => {
  res.json({
    count: confirmationRegistry.size,
    pending: confirmationRegistry.pendingIds(),
  });
});
