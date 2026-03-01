-- Migration: indexed_snapshot_composite_key
-- Allow multiple hashes per ordinal (fork support)

-- Step 1: Add auto-increment ID column
ALTER TABLE "IndexedSnapshot" ADD COLUMN "id" SERIAL;

-- Step 2: Drop the primary key on ordinal
ALTER TABLE "IndexedSnapshot" DROP CONSTRAINT "IndexedSnapshot_pkey";

-- Step 3: Set the new ID as primary key
ALTER TABLE "IndexedSnapshot" ADD CONSTRAINT "IndexedSnapshot_pkey" PRIMARY KEY ("id");

-- Step 4: Add unique constraint on (ordinal, hash)
CREATE UNIQUE INDEX "IndexedSnapshot_ordinal_hash_key" ON "IndexedSnapshot"("ordinal", "hash");

-- Step 5: Add index on ordinal for querying
CREATE INDEX "IndexedSnapshot_ordinal_idx" ON "IndexedSnapshot"("ordinal");
