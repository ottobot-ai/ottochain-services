/**
 * Cryptographic utilities for key storage (AES-256-GCM).
 *
 * Intentionally has zero imports beyond node:crypto to allow unit testing
 * without bringing in Prisma, dag4, or other heavyweight dependencies.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV (GCM recommended)
const TAG_LENGTH = 16;  // 128-bit auth tag

/** Length of an uncompressed EC public key in hex with 0x04 prefix (65 bytes = 130 hex chars) */
export const UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH = 130;
/** Length of a normalized EC public key in hex without 0x04 prefix (64 bytes = 128 hex chars) */
export const NORMALIZED_PUBLIC_KEY_HEX_LENGTH = 128;

/**
 * Get the AES-256-GCM encryption key from the environment.
 * Returns null if not configured — development mode, keys stored unencrypted.
 */
export function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.BRIDGE_KEY_ENCRYPTION_KEY;
  if (!keyHex) {
    return null;
  }
  if (keyHex.length !== 64) {
    throw new Error('BRIDGE_KEY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a private key for at-rest storage.
 *
 * When BRIDGE_KEY_ENCRYPTION_KEY is unset (dev mode), the key is stored
 * as-is with an UNENCRYPTED: sentinel prefix — logs a warning.
 */
export function encryptKey(privateKey: string): { encrypted: string; iv: string; tag: string } {
  const encryptionKey = getEncryptionKey();

  if (!encryptionKey) {
    console.warn('[key-store] WARNING: BRIDGE_KEY_ENCRYPTION_KEY not set. Storing keys unencrypted.');
    return { encrypted: `UNENCRYPTED:${privateKey}`, iv: '', tag: '' };
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a private key from at-rest storage.
 *
 * Handles the UNENCRYPTED: sentinel for dev mode.
 * Throws if GCM auth tag verification fails (tamper detected).
 */
export function decryptKey(encrypted: string, iv: string, tag: string): string {
  if (encrypted.startsWith('UNENCRYPTED:')) {
    return encrypted.slice('UNENCRYPTED:'.length);
  }

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    throw new Error('Cannot decrypt key: BRIDGE_KEY_ENCRYPTION_KEY not set');
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Normalize a public key to 128-char hex (strip 04 prefix if present).
 */
export function normalizePublicKey(publicKey: string): string {
  return publicKey.length === UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH
    ? publicKey.slice(2)
    : publicKey;
}
