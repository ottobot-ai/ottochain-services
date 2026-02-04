/**
 * RFC 8785 JSON Canonicalization
 *
 * Provides deterministic JSON serialization according to RFC 8785.
 * This ensures identical JSON objects always produce identical strings.
 */

import canonicalizeLib from 'canonicalize';

/**
 * Canonicalize JSON data according to RFC 8785
 *
 * Key features:
 * - Object keys sorted by UTF-16BE binary comparison
 * - Numbers serialized in shortest decimal representation
 * - No whitespace
 * - Proper Unicode escaping
 *
 * @param data - Any JSON-serializable object
 * @returns Canonical JSON string
 * @throws Error if data cannot be serialized to JSON
 *
 * @example
 * ```typescript
 * const canonical = canonicalize({ b: 2, a: 1 });
 * // Returns: '{"a":1,"b":2}'
 * ```
 */
export function canonicalize<T>(data: T): string {
  const result = canonicalizeLib(data);
  if (result === undefined) {
    throw new Error('Failed to canonicalize data: data cannot be serialized to JSON');
  }
  return result;
}
