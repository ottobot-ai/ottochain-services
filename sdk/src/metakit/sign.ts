/**
 * Signing Functions
 *
 * ECDSA signing using secp256k1 curve via dag4js.
 * Implements the Constellation signature protocol.
 */

import { dag4 } from '@stardust-collective/dag4';
import { sha256 } from 'js-sha256';
import { SignatureProof } from './types.js';
import { canonicalize } from './canonicalize.js';

/**
 * Sign data using the regular Constellation protocol (non-DataUpdate)
 *
 * Protocol:
 * 1. Canonicalize JSON (RFC 8785)
 * 2. SHA-256 hash the canonical JSON string
 * 3. Sign using dag4.keyStore.sign
 *
 * @param data - Any JSON-serializable object
 * @param privateKey - Private key in hex format
 * @returns SignatureProof with public key ID and signature
 *
 * @example
 * ```typescript
 * const proof = await sign({ action: 'test' }, privateKeyHex);
 * console.log(proof.id);        // public key (128 chars)
 * console.log(proof.signature); // DER signature
 * ```
 */
export async function sign<T>(data: T, privateKey: string): Promise<SignatureProof> {
  // Step 1: Canonicalize JSON (RFC 8785)
  const canonicalJson = canonicalize(data);

  // Step 2-3: UTF-8 encode and SHA-256 hash (sha256 handles UTF-8 encoding internally)
  // Returns 64-character hex string
  const hashHex = sha256(canonicalJson);

  // Step 4-6: dag4.keyStore.sign internally:
  //   4. Treats hashHex as UTF-8 bytes
  //   5. SHA-512 hashes those bytes, truncates to 32 bytes
  //   6. Signs with ECDSA secp256k1
  const signature = await dag4.keyStore.sign(privateKey, hashHex);

  // Get public key ID (without 04 prefix)
  const publicKey = dag4.keyStore.getPublicKeyFromPrivate(privateKey, false);
  const id = normalizePublicKeyId(publicKey);

  return { id, signature };
}

/**
 * Sign data as a DataUpdate (with Constellation prefix)
 *
 * Protocol:
 * 1. Canonicalize JSON (RFC 8785)
 * 2. Base64 encode the canonical JSON
 * 3. Sign using dag4.keyStore.dataSign (adds Constellation prefix internally)
 *
 * @param data - Any JSON-serializable object
 * @param privateKey - Private key in hex format
 * @returns SignatureProof
 */
export async function signDataUpdate<T>(data: T, privateKey: string): Promise<SignatureProof> {
  // Step 1: Canonicalize JSON
  const canonicalJson = canonicalize(data);

  // Step 2: Base64 encode for dataSign
  const base64String = Buffer.from(canonicalJson, 'utf-8').toString('base64');

  // Step 3: Sign using dag4's dataSign (handles Constellation prefix internally)
  const signature = await dag4.keyStore.dataSign(privateKey, base64String);

  // Get public key ID
  const publicKey = dag4.keyStore.getPublicKeyFromPrivate(privateKey, false);
  const id = normalizePublicKeyId(publicKey);

  return { id, signature };
}

/**
 * Sign a pre-computed SHA-256 hash
 *
 * This is the low-level signing function. Use `sign()` or `signDataUpdate()`
 * for most use cases.
 *
 * Protocol (performed by dag4.keyStore.sign):
 * 1. Treat hashHex as UTF-8 bytes (64 ASCII characters = 64 bytes)
 * 2. SHA-512 hash those bytes (produces 64 bytes)
 * 3. Truncate to first 32 bytes (for secp256k1 curve order)
 * 4. Sign with ECDSA secp256k1
 * 5. Return DER-encoded signature
 *
 * @param hashHex - SHA-256 hash as 64-character hex string
 * @param privateKey - Private key in hex format (64 characters)
 * @returns DER-encoded signature in hex format
 *
 * @example
 * ```typescript
 * // Compute your own hash
 * const hashHex = sha256(myData);
 * const signature = await signHash(hashHex, privateKey);
 * ```
 */
export async function signHash(hashHex: string, privateKey: string): Promise<string> {
  // dag4.keyStore.sign performs:
  // 1. SHA-512 of hashHex (treating 64 hex chars as UTF-8 bytes)
  // 2. Truncation to 32 bytes (handled internally by crypto library)
  // 3. ECDSA signing with secp256k1
  return dag4.keyStore.sign(privateKey, hashHex);
}

/**
 * Normalize public key to ID format (without 04 prefix, 128 chars)
 */
function normalizePublicKeyId(publicKey: string): string {
  // If 130 chars (with 04 prefix), remove prefix
  if (publicKey.length === 130 && publicKey.startsWith('04')) {
    return publicKey.substring(2);
  }
  // If 128 chars (without prefix), return as-is
  if (publicKey.length === 128) {
    return publicKey;
  }
  // Otherwise return as-is and let validation catch issues
  return publicKey;
}
