/**
 * Metakit SDK
 *
 * Reusable signing, encoding, and network operations for Constellation metagraphs.
 * This module is framework-level functionality, independent of any specific metagraph domain.
 *
 * @packageDocumentation
 */

// Core types
export type {
  SignatureProof,
  Signed,
  KeyPair,
  Hash,
  VerificationResult,
  SigningOptions,
} from './types.js';

export { ALGORITHM, CONSTELLATION_PREFIX } from './types.js';

// Canonicalization
export { canonicalize } from './canonicalize.js';

// Binary encoding
export { toBytes, encodeDataUpdate } from './binary.js';

// Hashing
export { hash, hashBytes, hashData, computeDigest } from './hash.js';

// Codec utilities
export { decodeDataUpdate } from './codec.js';

// Signing
export { sign, signDataUpdate, signHash } from './sign.js';

// Verification
export { verify, verifyHash, verifySignature } from './verify.js';

// High-level API
export { createSignedObject, addSignature, batchSign } from './signed-object.js';

// Wallet utilities
export {
  generateKeyPair,
  keyPairFromPrivateKey,
  getPublicKeyHex,
  getPublicKeyId,
  getAddress,
  isValidPrivateKey,
  isValidPublicKey,
} from './wallet.js';

// Currency transaction types
export type {
  TransactionReference,
  CurrencyTransactionValue,
  CurrencyTransaction,
  TransferParams,
} from './currency-types.js';

export { TOKEN_DECIMALS } from './currency-types.js';

// Currency transaction operations
export {
  createCurrencyTransaction,
  createCurrencyTransactionBatch,
  signCurrencyTransaction,
  verifyCurrencyTransaction,
  encodeCurrencyTransaction,
  hashCurrencyTransaction,
  getTransactionReference,
  isValidDagAddress,
  tokenToUnits,
  unitsToToken,
} from './currency-transaction.js';

// Network operations
export { CurrencyL1Client, DataL1Client, HttpClient, NetworkError } from './network/index.js';
export type {
  NetworkConfig,
  RequestOptions,
  TransactionStatus,
  PendingTransaction,
  PostTransactionResponse,
  EstimateFeeResponse,
  PostDataResponse,
} from './network/index.js';
