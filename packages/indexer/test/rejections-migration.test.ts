/**
 * Prisma Migration: Rejection Timestamp Index (TDD)
 *
 * Verifies that the migration file exists and the Prisma schema contains
 * the new timestamp index. These are static file checks, no DB needed.
 *
 * Spec: docs/design/rejection-history-filters-spec.md — Group 3
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Locate the prisma directory relative to this test file
// packages/indexer/test/ -> ../../.. -> repo root (ottochain-services/) -> prisma/
const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'prisma', 'migrations');
const SCHEMA_PATH = join(REPO_ROOT, 'prisma', 'schema.prisma');

describe('Prisma Migration: Rejection Timestamp Index (AC6)', () => {

  it('T10: migration directory contains a rejection_timestamp_index migration (AC6)', async () => {
    const dirs = await readdir(MIGRATIONS_DIR);
    const match = dirs.find(d => d.includes('rejection_timestamp_index'));
    expect(
      match !== undefined,
    ).toBeTruthy();

    // Also verify the SQL file contains the CREATE INDEX statement
    const sqlPath = join(MIGRATIONS_DIR, match!, 'migration.sql');
    const sql = await readFile(sqlPath, 'utf-8');
    expect(
      sql.includes('RejectedTransaction_timestamp_idx'),
    ).toBeTruthy();
  });

  it('T11: Prisma schema includes @@index([timestamp(sort: Desc)]) on RejectedTransaction (AC6)', async () => {
    const schema = await readFile(SCHEMA_PATH, 'utf-8');

    expect(
      schema.includes('model RejectedTransaction {'),
    ).toBeTruthy();

    expect(
      schema.includes('@@index([timestamp(sort: Desc)])'),
    ).toBeTruthy();
  });

});
