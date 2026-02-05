/**
 * Currency transaction operations for metagraph token transfers
 *
 * @packageDocumentation
 */

import {
  TransactionV2,
  txEncode,
  keyStore,
  type PostTransactionV2,
  type TransactionPropsV2,
  type AddressLastRefV2,
} from '@stardust-collective/dag4-keystore';
import type {
  CurrencyTransaction,
  TransactionReference,
  TransferParams,
} from './currency-types.js';
import { TOKEN_DECIMALS } from './currency-types.js';
import type { VerificationResult, SignatureProof } from './types.js';
import { getAddress } from './wallet.js';
import { normalizeSignatureToLowS } from './verify.js';

/**
 * Convert token amount to smallest units
 *
 * @param amount - Amount in token units (e.g., 100.5)
 * @returns Amount in smallest units (1e-8)
 *
 * @example
 * ```typescript
 * const units = tokenToUnits(100.5); // 10050000000
 * ```
 */
export function tokenToUnits(amount: number): number {
  return Math.floor(amount * 1e8);
}

/**
 * Convert smallest units to token amount
 *
 * @param units - Amount in smallest units
 * @returns Amount in token units
 *
 * @example
 * ```typescript
 * const tokens = unitsToToken(10050000000); // 100.5
 * ```
 */
export function unitsToToken(units: number): number {
  return units * TOKEN_DECIMALS;
}

/**
 * Validate DAG address format
 *
 * @param address - DAG address to validate
 * @returns True if address is valid
 *
 * @example
 * ```typescript
 * const valid = isValidDagAddress('DAG...');
 * ```
 */
export function isValidDagAddress(address: string): boolean {
  return keyStore.validateDagAddress(address);
}

/**
 * Create a metagraph token transaction
 *
 * @param params - Transfer parameters
 * @param privateKey - Private key to sign with (hex string)
 * @param lastRef - Reference to last accepted transaction
 * @returns Signed currency transaction
 *
 * @throws If addresses are invalid or amount is too small
 *
 * @example
 * ```typescript
 * const tx = await createCurrencyTransaction(
 *   { destination: 'DAG...', amount: 100.5, fee: 0 },
 *   privateKey,
 *   { hash: 'abc123...', ordinal: 5 }
 * );
 * ```
 */
export async function createCurrencyTransaction(
  params: TransferParams,
  privateKey: string,
  lastRef: TransactionReference
): Promise<CurrencyTransaction> {
  // Get source address from private key
  const publicKey = keyStore.getPublicKeyFromPrivate(privateKey);
  const source = getAddress(publicKey);

  // Validate addresses
  if (!isValidDagAddress(source)) {
    throw new Error('Invalid source address');
  }
  if (!isValidDagAddress(params.destination)) {
    throw new Error('Invalid destination address');
  }
  if (source === params.destination) {
    throw new Error('Source and destination addresses cannot be the same');
  }

  // Convert amounts to smallest units
  const amount = tokenToUnits(params.amount);
  const fee = tokenToUnits(params.fee ?? 0);

  // Validate amounts
  if (amount < 1) {
    throw new Error('Transfer amount must be greater than 1e-8');
  }
  if (fee < 0) {
    throw new Error('Fee must be greater than or equal to zero');
  }

  // Use dag4.js TransactionV2 to create and encode the transaction
  const txProps: TransactionPropsV2 = {
    fromAddress: source,
    toAddress: params.destination,
    amount,
    fee,
    lastTxRef: lastRef as AddressLastRefV2,
  };

  const tx = new TransactionV2(txProps);

  // Get encoded transaction for hashing
  const encodedTx = tx.getEncoded();

  // Kryo serialize - v2 uses setReferences = false (matching dag4.js behavior)
  const serializedTx = txEncode.kryoSerialize(encodedTx, false);

  // Hash the serialized transaction
  const hash = keyStore.sha256(Buffer.from(serializedTx, 'hex'));

  // Sign the hash
  const signature = await keyStore.sign(privateKey, hash);

  // Get uncompressed public key
  const uncompressedPublicKey =
    publicKey.length === 128 ? '04' + publicKey : publicKey;

  // Verify signature
  const success = keyStore.verify(uncompressedPublicKey, hash, signature);
  if (!success) {
    throw new Error('Sign-Verify failed');
  }

  // Add signature proof (remove '04' prefix from public key)
  const proof = {
    id: uncompressedPublicKey.substring(2),
    signature,
  };

  tx.addSignature(proof);

  return tx.getPostTransaction() as CurrencyTransaction;
}

/**
 * Create multiple metagraph token transactions (batch)
 *
 * @param transfers - Array of transfer parameters
 * @param privateKey - Private key to sign with
 * @param lastRef - Reference to last accepted transaction
 * @returns Array of signed currency transactions
 *
 * @throws If any address is invalid or amount is too small
 *
 * @example
 * ```typescript
 * const txns = await createCurrencyTransactionBatch(
 *   [
 *     { destination: 'DAG...1', amount: 10 },
 *     { destination: 'DAG...2', amount: 20 },
 *   ],
 *   privateKey,
 *   { hash: 'abc123...', ordinal: 5 }
 * );
 * ```
 */
export async function createCurrencyTransactionBatch(
  transfers: TransferParams[],
  privateKey: string,
  lastRef: TransactionReference
): Promise<CurrencyTransaction[]> {
  const transactions: CurrencyTransaction[] = [];
  let currentRef = { ...lastRef };

  for (const transfer of transfers) {
    const tx = await createCurrencyTransaction(
      transfer,
      privateKey,
      currentRef
    );

    // Calculate hash for next transaction's parent reference
    const hash = await hashCurrencyTransaction(tx);

    // Update reference for next transaction
    currentRef = {
      hash: hash.value,
      ordinal: currentRef.ordinal + 1,
    };

    transactions.push(tx);
  }

  return transactions;
}

/**
 * Add a signature to an existing currency transaction (for multi-sig)
 *
 * @param transaction - Transaction to sign
 * @param privateKey - Private key to sign with
 * @returns Transaction with additional signature
 *
 * @throws If sign-verify fails
 *
 * @example
 * ```typescript
 * const signedTx = await signCurrencyTransaction(tx, privateKey2);
 * ```
 */
export async function signCurrencyTransaction(
  transaction: CurrencyTransaction,
  privateKey: string
): Promise<CurrencyTransaction> {
  // Reconstruct TransactionV2 from PostTransaction
  const tx = TransactionV2.fromPostTransaction(
    transaction as PostTransactionV2
  );

  // Restore existing proofs (fromPostTransaction doesn't copy them)
  for (const existingProof of transaction.proofs) {
    tx.addSignature(existingProof);
  }

  // Get encoded transaction
  const encodedTx = tx.getEncoded();
  // Kryo serialize - v2 uses setReferences = false (matching dag4.js behavior)
  const serializedTx = txEncode.kryoSerialize(encodedTx, false);
  const hash = keyStore.sha256(Buffer.from(serializedTx, 'hex'));

  // Sign the hash
  const publicKey = keyStore.getPublicKeyFromPrivate(privateKey);
  const signature = await keyStore.sign(privateKey, hash);

  // Verify signature
  const uncompressedPublicKey =
    publicKey.length === 128 ? '04' + publicKey : publicKey;
  const success = keyStore.verify(uncompressedPublicKey, hash, signature);
  if (!success) {
    throw new Error('Sign-Verify failed');
  }

  // Add new proof
  const proof = {
    id: uncompressedPublicKey.substring(2),
    signature,
  };

  tx.addSignature(proof);

  return tx.getPostTransaction() as CurrencyTransaction;
}

/**
 * Verify all signatures on a currency transaction
 *
 * @param transaction - Transaction to verify
 * @returns Verification result with valid/invalid proofs
 *
 * @example
 * ```typescript
 * const result = await verifyCurrencyTransaction(tx);
 * console.log('Valid:', result.isValid);
 * ```
 */
export async function verifyCurrencyTransaction(
  transaction: CurrencyTransaction
): Promise<VerificationResult> {
  // Reconstruct TransactionV2 to get encoded form
  const tx = TransactionV2.fromPostTransaction(
    transaction as PostTransactionV2
  );

  // Get hash
  const encodedTx = tx.getEncoded();
  // Kryo serialize - v2 uses setReferences = false (matching dag4.js behavior)
  const serializedTx = txEncode.kryoSerialize(encodedTx, false);
  const hash = keyStore.sha256(Buffer.from(serializedTx, 'hex'));

  const validProofs: SignatureProof[] = [];
  const invalidProofs: SignatureProof[] = [];

  // Verify each proof
  for (const proof of transaction.proofs) {
    const publicKey = '04' + proof.id; // Add back the '04' prefix
    // Normalize signature to low-S form for BIP 62/146 compatibility
    const normalizedSignature = normalizeSignatureToLowS(proof.signature);
    const isValid = keyStore.verify(publicKey, hash, normalizedSignature);

    if (isValid) {
      validProofs.push(proof);
    } else {
      invalidProofs.push(proof);
    }
  }

  return {
    isValid: invalidProofs.length === 0 && validProofs.length > 0,
    validProofs,
    invalidProofs,
  };
}

/**
 * Encode a currency transaction for hashing
 *
 * @param transaction - Transaction to encode
 * @returns Hex-encoded string
 *
 * @example
 * ```typescript
 * const encoded = encodeCurrencyTransaction(tx);
 * ```
 */
export function encodeCurrencyTransaction(
  transaction: CurrencyTransaction
): string {
  const tx = TransactionV2.fromPostTransaction(
    transaction as PostTransactionV2
  );
  return tx.getEncoded();
}

/**
 * Hash a currency transaction
 *
 * @param transaction - Transaction to hash
 * @returns Hash object with value and bytes
 *
 * @example
 * ```typescript
 * const hash = await hashCurrencyTransaction(tx);
 * console.log('Hash:', hash.value);
 * ```
 */
export async function hashCurrencyTransaction(
  transaction: CurrencyTransaction
): Promise<{ value: string; bytes: Uint8Array }> {
  const encoded = encodeCurrencyTransaction(transaction);
  // Kryo serialize - v2 uses setReferences = false (matching dag4.js behavior)
  const serialized = txEncode.kryoSerialize(encoded, false);
  const hash = keyStore.sha256(Buffer.from(serialized, 'hex'));

  return {
    value: hash,
    bytes: Buffer.from(hash, 'hex'),
  };
}

/**
 * Get transaction reference from a currency transaction
 * Useful for chaining transactions
 *
 * @param transaction - Transaction to extract reference from
 * @param ordinal - Ordinal number for this transaction
 * @returns Transaction reference
 *
 * @example
 * ```typescript
 * const ref = await getTransactionReference(tx, 6);
 * // Use ref as lastRef for next transaction
 * ```
 */
export async function getTransactionReference(
  transaction: CurrencyTransaction,
  ordinal: number
): Promise<TransactionReference> {
  const hash = await hashCurrencyTransaction(transaction);
  return {
    hash: hash.value,
    ordinal,
  };
}
