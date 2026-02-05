/**
 * Core type definitions for the Ottochain SDK
 */

/**
 * A signature proof containing the signer's public key ID and signature
 */
export interface SignatureProof {
  /** Public key hex (uncompressed, without 04 prefix) - 128 characters */
  id: string;
  /** DER-encoded ECDSA signature in hex format */
  signature: string;
}

/**
 * A signed object wrapping a value with one or more signature proofs
 */
export interface Signed<T> {
  /** The signed value */
  value: T;
  /** Array of signature proofs */
  proofs: SignatureProof[];
}

/**
 * A key pair for signing operations
 */
export interface KeyPair {
  /** Private key in hex format */
  privateKey: string;
  /** Public key in hex format (uncompressed, with 04 prefix) */
  publicKey: string;
  /** DAG address derived from the public key */
  address: string;
}

/**
 * A hash result containing both hex string and raw bytes
 */
export interface Hash {
  /** SHA-256 hash as 64-character hex string */
  value: string;
  /** Raw 32-byte hash as Uint8Array */
  bytes: Uint8Array;
}

/**
 * Result of signature verification
 */
export interface VerificationResult {
  /** Whether all signatures are valid */
  isValid: boolean;
  /** Proofs that passed verification */
  validProofs: SignatureProof[];
  /** Proofs that failed verification */
  invalidProofs: SignatureProof[];
}

/**
 * Options for signing operations
 */
export interface SigningOptions {
  /** Whether to sign as a DataUpdate (with Constellation prefix) */
  isDataUpdate?: boolean;
}

/**
 * Supported signature algorithm
 */
export const ALGORITHM = 'SECP256K1_RFC8785_V1' as const;

/**
 * Constellation prefix for DataUpdate signing
 */
export const CONSTELLATION_PREFIX = '\x19Constellation Signed Data:\n';
