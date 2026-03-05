/**
 * Prisma Migration: Rejection Timestamp Index (TDD)
 *
 * Verifies that the migration file exists and the Prisma schema contains
 * the new timestamp index. These are static file checks, no DB needed.
 *
 * Spec: docs/design/rejection-history-filters-spec.md — Group 3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
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
    assert.ok(
      match !== undefined,
      `Expected a migration directory containing "rejection_timestamp_index" in ${MIGRATIONS_DIR}.\n` +
      `Found: ${dirs.join(', ')}`
    );

    // Also verify the SQL file contains the CREATE INDEX statement
    const sqlPath = join(MIGRATIONS_DIR, match, 'migration.sql');
    const sql = await readFile(sqlPath, 'utf-8');
    assert.ok(
      sql.includes('RejectedTransaction_timestamp_idx'),
      `Migration SQL should create "RejectedTransaction_timestamp_idx" index.\nSQL content:\n${sql}`
    );
  });

  it('T11: Prisma schema includes @@index([timestamp(sort: Desc)]) on RejectedTransaction (AC6)', async () => {
    const schema = await readFile(SCHEMA_PATH, 'utf-8');

    // Verify the model exists
    assert.ok(
      schema.includes('model RejectedTransaction {'),
      'Could not find "model RejectedTransaction" block in schema.prisma'
    );

    // Verify the timestamp index is present in the schema
    // (The index is inside the RejectedTransaction model block)
    assert.ok(
      schema.includes('@@index([timestamp(sort: Desc)])'),
      `schema.prisma should contain @@index([timestamp(sort: Desc)]) inside RejectedTransaction model.\n` +
      `Schema excerpt around RejectedTransaction:\n` +
      schema.slice(
        Math.max(0, schema.indexOf('model RejectedTransaction {')),
        schema.indexOf('model RejectedTransaction {') + 600
      )
    );
  });

});
