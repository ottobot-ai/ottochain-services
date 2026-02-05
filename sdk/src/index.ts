/**
 * Ottochain SDK
 *
 * Unified SDK combining metakit framework operations with ottochain domain types.
 *
 * - `metakit` — Signing, encoding, hashing, and network clients for Constellation metagraphs
 * - `ottochain` — Domain types, state models, and message formats for the ottochain metagraph
 *
 * @packageDocumentation
 */

// Re-export everything from both modules at the top level for convenience
export * from './metakit/index.js';
export * from './ottochain/index.js';
