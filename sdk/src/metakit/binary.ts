/**
 * Binary Encoding
 *
 * Converts JSON data to binary format for cryptographic operations.
 * Supports both regular encoding and DataUpdate encoding with Constellation prefix.
 */

import { canonicalize } from './canonicalize.js';
import { CONSTELLATION_PREFIX } from './types.js';

/**
 * Convert data to binary bytes for signing
 *
 * For regular data:
 *   JSON -> RFC 8785 canonicalization -> UTF-8 bytes
 *
 * For DataUpdate (isDataUpdate=true):
 *   JSON -> RFC 8785 -> UTF-8 -> Base64 -> prepend Constellation prefix -> UTF-8 bytes
 *
 * @param data - Any JSON-serializable object
 * @param isDataUpdate - If true, applies DataUpdate encoding with Constellation prefix
 * @returns Binary bytes as Uint8Array
 *
 * @example
 * ```typescript
 * // Regular encoding
 * const bytes = toBytes({ action: 'test' });
 *
 * // DataUpdate encoding
 * const updateBytes = toBytes({ action: 'test' }, true);
 * ```
 */
export function toBytes<T>(data: T, isDataUpdate: boolean = false): Uint8Array {
  const canonicalJson = canonicalize(data);
  const utf8Bytes = new TextEncoder().encode(canonicalJson);

  if (isDataUpdate) {
    // Base64 encode the UTF-8 bytes
    const base64String = Buffer.from(utf8Bytes).toString('base64');
    // Create the wrapped string with Constellation prefix
    const wrappedString = `${CONSTELLATION_PREFIX}${base64String.length}\n${base64String}`;
    return new TextEncoder().encode(wrappedString);
  }

  return utf8Bytes;
}

/**
 * Encode data as a DataUpdate with Constellation prefix
 *
 * This is equivalent to `toBytes(data, true)`.
 *
 * @param data - Any JSON-serializable object
 * @returns Binary bytes with Constellation prefix
 */
export function encodeDataUpdate<T>(data: T): Uint8Array {
  return toBytes(data, true);
}
