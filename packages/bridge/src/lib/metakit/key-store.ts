/**
 * Key Store for Server-Signed Mode
 * 
 * Stores private keys for agents registered in server-signed mode.
 * Keys are persisted in Postgres via Prisma and encrypted at rest using AES-256-GCM.
 * 
 * Encryption key is read from BRIDGE_KEY_ENCRYPTION_KEY environment variable.
 * If not set, keys are stored unencrypted (development only - logs a warning).
 */

import { PrismaClient, SigningMode as PrismaSigningMode } from '@prisma/client';
import { generateKeyPair, keyPairFromPrivateKey } from '../../metagraph.js';
import type { KeyPair } from '../../metagraph.js';
import {
  encryptKey,
  decryptKey,
  normalizePublicKey,
  UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH,
  NORMALIZED_PUBLIC_KEY_HEX_LENGTH,
} from './crypto.js';

// Re-export constants and crypto utilities for consumers
export { encryptKey, decryptKey, UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH, NORMALIZED_PUBLIC_KEY_HEX_LENGTH };

// Lazy-init Prisma client (shared across requests)
let prismaClient: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

export type SigningMode = 'server' | 'self';

export interface FiberKeyMetadata {
  signingMode: SigningMode;
  publicKey: string;
  address: string;
  createdAt: Date;
}

/**
 * Key store interface for managing server-stored keys.
 */
export interface KeyStore {
  get(fiberId: string): Promise<string | undefined>;
  set(fiberId: string, privateKey: string): Promise<void>;
  delete(fiberId: string): Promise<void>;
  has(fiberId: string): Promise<boolean>;
  getMode(fiberId: string): Promise<SigningMode | undefined>;
  setMetadata(fiberId: string, metadata: FiberKeyMetadata): Promise<void>;
  getMetadata(fiberId: string): Promise<FiberKeyMetadata | undefined>;
}

/**
 * Prisma-backed key store implementation.
 * 
 * Keys are encrypted at rest using AES-256-GCM when BRIDGE_KEY_ENCRYPTION_KEY is set.
 */
class PrismaKeyStore implements KeyStore {
  async get(fiberId: string): Promise<string | undefined> {
    const prisma = getPrisma();
    const record = await prisma.signingKey.findUnique({
      where: { fiberId },
    });
    
    if (!record || !record.encryptedKey) {
      return undefined;
    }
    
    // Update last used timestamp
    await prisma.signingKey.update({
      where: { fiberId },
      data: { lastUsedAt: new Date() },
    }).catch((err: Error) => { console.debug('[key-store] Non-critical lastUsedAt update failed:', err.message); });
    
    return decryptKey(record.encryptedKey, record.keyIv ?? '', record.keyTag ?? '');
  }
  
  async set(fiberId: string, privateKey: string): Promise<void> {
    const prisma = getPrisma();
    const { encrypted, iv, tag } = encryptKey(privateKey);
    const keyPair = keyPairFromPrivateKey(privateKey);
    
    // Normalize public key to 128 chars (no 04 prefix)
    const publicKey = keyPair.publicKey.length === UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH 
      ? keyPair.publicKey.slice(2) 
      : keyPair.publicKey;
    
    await prisma.signingKey.upsert({
      where: { fiberId },
      create: {
        fiberId,
        signingMode: 'SERVER',
        publicKey,
        address: keyPair.address,
        encryptedKey: encrypted,
        keyIv: iv,
        keyTag: tag,
      },
      update: {
        encryptedKey: encrypted,
        keyIv: iv,
        keyTag: tag,
      },
    });
    
    console.log(`[key-store] Stored server-signed key for fiber ${fiberId}`);
  }
  
  async delete(fiberId: string): Promise<void> {
    const prisma = getPrisma();
    await prisma.signingKey.delete({
      where: { fiberId },
    }).catch((err: Error) => { console.debug('[key-store] Delete skipped (not found):', err.message); });
    
    console.log(`[key-store] Deleted key for fiber ${fiberId}`);
  }
  
  async has(fiberId: string): Promise<boolean> {
    const prisma = getPrisma();
    const record = await prisma.signingKey.findUnique({
      where: { fiberId },
      select: { fiberId: true, encryptedKey: true },
    });
    return record !== null && record.encryptedKey !== null;
  }
  
  async getMode(fiberId: string): Promise<SigningMode | undefined> {
    const prisma = getPrisma();
    const record = await prisma.signingKey.findUnique({
      where: { fiberId },
      select: { signingMode: true },
    });
    
    if (!record) return undefined;
    return record.signingMode === 'SERVER' ? 'server' : 'self';
  }
  
  async setMetadata(fiberId: string, metadata: FiberKeyMetadata): Promise<void> {
    const prisma = getPrisma();
    
    // Normalize public key to 128 chars
    const publicKey = metadata.publicKey.length === UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH 
      ? metadata.publicKey.slice(2) 
      : metadata.publicKey;
    
    const signingMode: PrismaSigningMode = metadata.signingMode === 'server' ? 'SERVER' : 'SELF';
    
    await prisma.signingKey.upsert({
      where: { fiberId },
      create: {
        fiberId,
        signingMode,
        publicKey,
        address: metadata.address,
        encryptedKey: null,
        keyIv: null,
        keyTag: null,
      },
      update: {
        signingMode,
        publicKey,
        address: metadata.address,
      },
    });
    
    console.log(`[key-store] Stored metadata for fiber ${fiberId} (${metadata.signingMode} mode)`);
  }
  
  async getMetadata(fiberId: string): Promise<FiberKeyMetadata | undefined> {
    const prisma = getPrisma();
    const record = await prisma.signingKey.findUnique({
      where: { fiberId },
    });
    
    if (!record) return undefined;
    
    return {
      signingMode: record.signingMode === 'SERVER' ? 'server' : 'self',
      publicKey: record.publicKey,
      address: record.address,
      createdAt: record.createdAt,
    };
  }
}

// Singleton instance
const keyStoreInstance = new PrismaKeyStore();

/**
 * Get the global key store instance.
 */
export function getKeyStore(): KeyStore {
  return keyStoreInstance;
}

/**
 * Result of registering a new agent with server-signed mode.
 */
export interface ServerKeyRegistration {
  fiberId: string;
  keyPair: KeyPair;
}

/**
 * Register a new agent with server-signed mode.
 * Generates a keypair and stores it encrypted in the database.
 */
export async function registerServerSigned(fiberId: string): Promise<ServerKeyRegistration> {
  const keyPair = generateKeyPair();
  
  const store = getKeyStore();
  await store.set(fiberId, keyPair.privateKey);
  await store.setMetadata(fiberId, {
    signingMode: 'server',
    publicKey: keyPair.publicKey,
    address: keyPair.address,
    createdAt: new Date(),
  });
  
  console.log(`[key-store] Registered server-signed agent: ${fiberId} -> ${keyPair.address}`);
  
  return { fiberId, keyPair };
}

/**
 * Result of registering a new agent with self-signed mode.
 */
export interface SelfKeyRegistration {
  fiberId: string;
  publicKey: string;
  address: string;
}

/**
 * Register a new agent with self-signed mode.
 * Stores the public key for signature validation (no private key).
 */
export async function registerSelfSigned(
  fiberId: string,
  publicKey: string
): Promise<SelfKeyRegistration> {
  // Derive address from public key
  // dag4 expects 130-char key with 04 prefix
  const fullPublicKey = publicKey.length === NORMALIZED_PUBLIC_KEY_HEX_LENGTH ? `04${publicKey}` : publicKey;
  
  // Import dag4 to derive address
  const { dag4 } = await import('@stardust-collective/dag4');
  const address = dag4.keyStore.getDagAddressFromPublicKey(fullPublicKey);
  
  const store = getKeyStore();
  await store.setMetadata(fiberId, {
    signingMode: 'self',
    publicKey: publicKey.length === NORMALIZED_PUBLIC_KEY_HEX_LENGTH ? publicKey : publicKey.slice(2),
    address,
    createdAt: new Date(),
  });
  
  console.log(`[key-store] Registered self-signed agent: ${fiberId} -> ${address}`);
  
  return { fiberId, publicKey, address };
}

/**
 * Get the private key for signing a transaction.
 * Throws if fiber is not in server-signed mode or key not found.
 */
export async function getSigningKey(fiberId: string): Promise<string> {
  const store = getKeyStore();
  const mode = await store.getMode(fiberId);
  
  if (mode === 'self') {
    throw new Error(`Fiber ${fiberId} is in self-signed mode. Submit pre-signed transactions.`);
  }
  
  const key = await store.get(fiberId);
  if (!key) {
    throw new Error(`No key found for fiber ${fiberId}. Was it registered with server-signed mode?`);
  }
  
  return key;
}

/**
 * Validate that a self-signed transaction's signer owns the fiber.
 */
export async function validateSelfSignedOwnership(
  fiberId: string,
  signerPublicKeyId: string
): Promise<{ valid: boolean; error?: string }> {
  const store = getKeyStore();
  const metadata = await store.getMetadata(fiberId);
  
  if (!metadata) {
    return { valid: false, error: 'Fiber not registered with bridge' };
  }
  
  if (metadata.signingMode !== 'self') {
    return { valid: false, error: 'Fiber is not in self-signed mode' };
  }
  
  // Normalize both keys to 128-char format (no 04 prefix) for comparison
  const normalizedSigner = signerPublicKeyId.length === UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH 
    ? signerPublicKeyId.slice(2) 
    : signerPublicKeyId;
  const normalizedRegistered = metadata.publicKey.length === UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH 
    ? metadata.publicKey.slice(2) 
    : metadata.publicKey;
  
  if (normalizedSigner.toLowerCase() !== normalizedRegistered.toLowerCase()) {
    return { valid: false, error: 'Signer does not match registered owner' };
  }
  
  return { valid: true };
}
