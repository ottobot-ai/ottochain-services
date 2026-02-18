// Routes index — mounts all API sub-routers under /api
//
// Adds:
//   /api/rejections              → rejectionsRouter
//   /api/rejections/:hash        → rejectionsRouter
//   /api/fibers/:id/rejections   → inline handler (rejection sub-resource)

import express from 'express';
import { prisma } from '@ottochain/shared';
import type { Prisma } from '@prisma/client';
import { rejectionsRouter } from './rejections.js';

const _router = express.Router();

// ── /api/rejections ─────────────────────────────────────────────────────────
_router.use('/rejections', rejectionsRouter);

// ── /api/fibers/:fiberId/rejections ─────────────────────────────────────────
// Returns the rejection history for a specific fiber with pagination.
// Query params: limit (default 50, max 100), offset (default 0)
_router.get('/fibers/:fiberId/rejections', async (req, res) => {
  try {
    const { fiberId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit  as string || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset as string || '0',  10), 0);

    const where: Prisma.RejectedTransactionWhereInput = { fiberId };

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
      rejections: rejections.map(r => ({
        id: r.id,
        ordinal: Number(r.ordinal),
        timestamp: r.timestamp,
        updateType: r.updateType,
        fiberId: r.fiberId,
        updateHash: r.updateHash,
        errors: r.errors,
        signers: r.signers,
        createdAt: r.createdAt,
      })),
      total,
      hasMore: offset + rejections.length < total,
    });
  } catch (err) {
    console.error('GET /api/fibers/:fiberId/rejections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stable type annotation avoids TS2742 "inferred type cannot be named" error
export const apiRouter: import('express').Router = _router;
