/**
 * High-Level Signed Object API
 *
 * Convenience functions for creating and managing signed objects.
 */

import { Signed, SignatureProof, SigningOptions } from './types.js';
import { sign, signDataUpdate } from './sign.js';

/**
 * Create a signed object with a single signature
 *
 * @param value - Any JSON-serializable object
 * @param privateKey - Private key in hex format
 * @param options - Signing options
 * @returns Signed object ready for submission
 *
 * @example
 * ```typescript
 * // Sign a regular data object
 * const signed = await createSignedObject(myData, privateKey);
 *
 * // Sign as DataUpdate for L1 submission
 * const signedUpdate = await createSignedObject(myData, privateKey, { isDataUpdate: true });
 * ```
 */
export async function createSignedObject<T>(
  value: T,
  privateKey: string,
  options: SigningOptions = {}
): Promise<Signed<T>> {
  const { isDataUpdate = false } = options;

  const proof = isDataUpdate
    ? await signDataUpdate(value, privateKey)
    : await sign(value, privateKey);

  return {
    value,
    proofs: [proof],
  };
}

/**
 * Add an additional signature to an existing signed object
 *
 * This allows building multi-signature objects where multiple parties
 * need to sign the same data.
 *
 * @param signed - Existing signed object
 * @param privateKey - Private key in hex format
 * @param options - Signing options (must match original signing)
 * @returns New signed object with additional proof
 *
 * @example
 * ```typescript
 * // First party signs
 * let signed = await createSignedObject(data, party1Key);
 *
 * // Second party adds signature
 * signed = await addSignature(signed, party2Key);
 *
 * // Now has 2 proofs
 * console.log(signed.proofs.length); // 2
 * ```
 */
export async function addSignature<T>(
  signed: Signed<T>,
  privateKey: string,
  options: SigningOptions = {}
): Promise<Signed<T>> {
  const { isDataUpdate = false } = options;

  const newProof = isDataUpdate
    ? await signDataUpdate(signed.value, privateKey)
    : await sign(signed.value, privateKey);

  return {
    value: signed.value,
    proofs: [...signed.proofs, newProof],
  };
}

/**
 * Create a signed object with multiple signatures at once
 *
 * Useful when you have access to multiple private keys and want
 * to create a multi-sig object in one operation.
 *
 * @param value - Any JSON-serializable object
 * @param privateKeys - Array of private keys in hex format
 * @param options - Signing options
 * @returns Signed object with multiple proofs
 *
 * @example
 * ```typescript
 * const signed = await batchSign(data, [key1, key2, key3]);
 * console.log(signed.proofs.length); // 3
 * ```
 */
export async function batchSign<T>(
  value: T,
  privateKeys: string[],
  options: SigningOptions = {}
): Promise<Signed<T>> {
  if (privateKeys.length === 0) {
    throw new Error('At least one private key is required');
  }

  const { isDataUpdate = false } = options;

  const proofs: SignatureProof[] = await Promise.all(
    privateKeys.map((key) => (isDataUpdate ? signDataUpdate(value, key) : sign(value, key)))
  );

  return {
    value,
    proofs,
  };
}
