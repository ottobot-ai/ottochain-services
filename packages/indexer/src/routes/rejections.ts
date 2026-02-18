// Rejection query API routes
// Exposes rejected transactions stored by the webhook rejection handler.
//
// Endpoints:
//   GET /api/rejections              - list with full filter set
//   GET /api/rejections/:updateHash  - single rejection by dedup hash
//
// Filters supported by GET /api/rejections:
//   fiberId     - target fiber UUID
//   updateType  - CreateStateMachine | TransitionStateMachine | ArchiveStateMachine | CreateScript | InvokeScript
//   signer      - DAG address (array contains, via PostgreSQL `= ANY(signers)`)
//   errorCode   - validation error code (JSONB contains, via PostgreSQL `@>`)
//   fromOrdinal - ordinal >= value
//   toOrdinal   - ordinal <= value
//   limit       - max results (default 50, max 100)
//   offset      - pagination offset (default 0)

import express from 'express';
import { prisma } from '@ottochain/shared';
import type { Prisma } from '@prisma/client';

const _router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// Serialization helper — converts DB row to API response shape
// ──────────────────────────────────────────────────────────────────────────────
function formatRejection(
  r: {
    id: number;
    ordinal: bigint;
    timestamp: Date;
    updateType: string;
    fiberId: string;
    updateHash: string;
    errors: Prisma.JsonValue;
    signers: string[];
    createdAt: Date;
    rawPayload?: Prisma.JsonValue | null;
  },
  includeRaw = false
) {
  const out: Record<string, unknown> = {
    id: r.id,
    ordinal: Number(r.ordinal),
    timestamp: r.timestamp,
    updateType: r.updateType,
    fiberId: r.fiberId,
    updateHash: r.updateHash,
    errors: r.errors,
    signers: r.signers,
    createdAt: r.createdAt,
  };
  if (includeRaw) out.rawPayload = r.rawPayload ?? null;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rejections
// ──────────────────────────────────────────────────────────────────────────────
_router.get('/', async (req, res) => {
  try {
    const fiberId     = req.query.fiberId    as string | undefined;
    const updateType  = req.query.updateType as string | undefined;
    const signer      = req.query.signer     as string | undefined;
    const errorCode   = req.query.errorCode  as string | undefined;
    const fromOrdinal = req.query.fromOrdinal !== undefined
      ? parseInt(req.query.fromOrdinal as string, 10)
      : undefined;
    const toOrdinal   = req.query.toOrdinal !== undefined
      ? parseInt(req.query.toOrdinal as string, 10)
      : undefined;
    const limit  = Math.min(parseInt(req.query.limit  as string || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset as string || '0',  10), 0);

    const where: Prisma.RejectedTransactionWhereInput = {};

    if (fiberId)    where.fiberId    = fiberId;
    if (updateType) where.updateType = updateType;

    // Signer filter: PostgreSQL String[] "has" — generates `= ANY(signers)`
    if (signer) where.signers = { has: signer };

    // ErrorCode filter: JSONB array_contains — generates `errors @> '[{"code":"..."}]'`
    // This finds records where errors array contains at least one element with the given code.
    if (errorCode) {
      where.errors = { array_contains: [{ code: errorCode }] };
    }

    // Ordinal range
    if (fromOrdinal !== undefined || toOrdinal !== undefined) {
      const ordinalFilter: Prisma.BigIntFilter = {};
      if (fromOrdinal !== undefined) ordinalFilter.gte = BigInt(fromOrdinal);
      if (toOrdinal   !== undefined) ordinalFilter.lte = BigInt(toOrdinal);
      where.ordinal = ordinalFilter;
    }

    const [rejections, total] = await Promise.all([
      prisma.rejectedTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.rejectedTransaction.count({ where }),
    ]);

    res.json({
      rejections: rejections.map(r => formatRejection(r)),
      total,
      hasMore: offset + rejections.length < total,
    });
  } catch (err) {
    console.error('GET /api/rejections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rejections/:updateHash
// Returns rejection with rawPayload or 404.
// ──────────────────────────────────────────────────────────────────────────────
_router.get('/:updateHash', async (req, res) => {
  try {
    const rejection = await prisma.rejectedTransaction.findUnique({
      where: { updateHash: req.params.updateHash },
    });

    if (!rejection) {
      res.status(404).json({ error: 'Rejection not found' });
      return;
    }

    res.json(formatRejection(rejection, /* includeRaw */ true));
  } catch (err) {
    console.error('GET /api/rejections/:updateHash error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stable type annotation avoids TS2742 "inferred type cannot be named" error
export const rejectionsRouter: import('express').Router = _router;
