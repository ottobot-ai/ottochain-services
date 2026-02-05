/**
 * Hashing Utilities
 *
 * SHA-256 and SHA-512 hashing for the Constellation signature protocol.
 */

import { sha256 } from 'js-sha256';
import { sha512 } from 'js-sha512';
import { Hash } from './types.js';
import { toBytes } from './binary.js';

/**
 * Compute SHA-256 hash of canonical JSON data
 *
 * @param data - Any JSON-serializable object
 * @returns Hash object with hex string and raw bytes
 *
 * @example
 * ```typescript
 * const hashResult = hash({ action: 'test' });
 * console.log(hashResult.value); // 64-char hex string
 * ```
 */
export function hash<T>(data: T): Hash {
  const bytes = toBytes(data, false);
  return hashBytes(bytes);
}

/**
 * Compute SHA-256 hash of raw bytes
 *
 * @param bytes - Input bytes
 * @returns Hash object with hex string and raw bytes
 */
export function hashBytes(bytes: Uint8Array): Hash {
  const hashArray = sha256.array(bytes);
  const hashUint8 = new Uint8Array(hashArray);
  const hashHex = sha256.hex(bytes);

  return {
    value: hashHex,
    bytes: hashUint8,
  };
}

/**
 * Compute the full signing digest according to Constellation protocol
 *
 * Protocol:
 * 1. Serialize data to binary (with optional DataUpdate prefix)
 * 2. Compute SHA-256 hash
 * 3. Convert hash to hex string
 * 4. Treat hex string as UTF-8 bytes (NOT hex decode)
 * 5. Compute SHA-512 of those bytes
 * 6. Truncate to 32 bytes for secp256k1 signing
 *
 * @param data - Any JSON-serializable object
 * @param isDataUpdate - Whether to apply DataUpdate encoding
 * @returns 32-byte digest ready for ECDSA signing
 */
export function computeDigest<T>(data: T, isDataUpdate: boolean = false): Uint8Array {
  // Step 1: Serialize to binary
  const dataBytes = toBytes(data, isDataUpdate);

  // Step 2: SHA-256 hash
  const sha256Hash = hashBytes(dataBytes);

  // Step 3-4: Hex string as UTF-8 bytes (critical: NOT hex decode)
  const hexAsUtf8 = new TextEncoder().encode(sha256Hash.value);

  // Step 5: SHA-512
  const sha512Hash = sha512.array(hexAsUtf8);

  // Step 6: Truncate to 32 bytes
  return new Uint8Array(sha512Hash.slice(0, 32));
}

/**
 * Compute SHA-256 hash of data with optional DataUpdate encoding
 *
 * @param data - Any JSON-serializable object
 * @param isDataUpdate - Whether to apply DataUpdate encoding
 * @returns Hash object
 */
export function hashData<T>(data: T, isDataUpdate: boolean = false): Hash {
  const bytes = toBytes(data, isDataUpdate);
  return hashBytes(bytes);
}
