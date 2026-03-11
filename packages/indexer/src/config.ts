/**
 * Indexer-specific required configuration.
 *
 * The shared ConfigSchema marks METAGRAPH_ID and GL0_URL as optional because
 * not every service needs them. The indexer requires both — this module
 * validates them eagerly so the rest of the indexer can use them without
 * non-null assertions or runtime guards.
 *
 * METAGRAPH_ID should be sourced from the ML0 node (its CL_TOKEN_ID env var)
 * rather than discovered from GL0, since public networks may host multiple
 * metagraphs.
 */

import { z } from 'zod';

const IndexerRequiredSchema = z.object({
  METAGRAPH_ID: z.string().min(1, 'METAGRAPH_ID must be a non-empty DAG address'),
  GL0_URL: z.string().url('GL0_URL must be a valid URL'),
});

export type IndexerRequired = z.infer<typeof IndexerRequiredSchema>;

let _indexerRequired: IndexerRequired | null = null;

/**
 * Returns indexer-required config fields, throwing a ZodError (with a clear
 * human-readable message) if either is missing or malformed at startup.
 */
export function getIndexerRequired(): IndexerRequired {
  if (!_indexerRequired) {
    _indexerRequired = IndexerRequiredSchema.parse(process.env);
  }
  return _indexerRequired;
}
