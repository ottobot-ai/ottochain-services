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
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { generateKeyPair, keyPairFromPrivateKey } from '../../metagraph.js';
import type { KeyPair } from '../../metagraph.js';

// Lazy-init Prisma client (shared across requests)
let prismaClient: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Get the encryption key from environment.
 * Returns null if not configured (development mode - keys stored unencrypted).
 */
function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.BRIDGE_KEY_ENCRYPTION_KEY;
  if (!keyHex) {
    return null;
  }
  // Expect 64-char hex string (32 bytes)
  if (keyHex.length !== 64) {
    throw new Error('BRIDGE_KEY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a private key for storage.
 */
function encryptKey(privateKey: string): { encrypted: string; iv: string; tag: string } {
  const encryptionKey = getEncryptionKey();
  
  if (!encryptionKey) {
    // Development mode - store as-is with marker
    console.warn('[key-store] WARNING: BRIDGE_KEY_ENCRYPTION_KEY not set. Storing keys unencrypted.');
    return {
      encrypted: `UNENCRYPTED:${privateKey}`,
      iv: '',
      tag: '',
    };
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
 * Decrypt a private key from storage.
 */
function decryptKey(encrypted: string, iv: string, tag: string): string {
  // Check for unencrypted marker (development mode)
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
    }).catch(() => {}); // Non-critical, don't fail on update error
    
    return decryptKey(record.encryptedKey, record.keyIv ?? '', record.keyTag ?? '');
  }
  
  async set(fiberId: string, privateKey: string): Promise<void> {
    const prisma = getPrisma();
    const { encrypted, iv, tag } = encryptKey(privateKey);
    const keyPair = keyPairFromPrivateKey(privateKey);
    
    // Normalize public key to 128 chars (no 04 prefix)
    const publicKey = keyPair.publicKey.length === 130 
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
    }).catch(() => {}); // Ignore if not found
    
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
    const publicKey = metadata.publicKey.length === 130 
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
  const fullPublicKey = publicKey.length === 128 ? `04${publicKey}` : publicKey;
  
  // Import dag4 to derive address
  const { dag4 } = await import('@stardust-collective/dag4');
  const address = dag4.keyStore.getDagAddressFromPublicKey(fullPublicKey);
  
  const store = getKeyStore();
  await store.setMetadata(fiberId, {
    signingMode: 'self',
    publicKey: publicKey.length === 128 ? publicKey : publicKey.slice(2),
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
  
  // Normalize both keys to 128-char format for comparison
  const normalizedSigner = signerPublicKeyId.length === 130 
    ? signerPublicKeyId.slice(2) 
    : signerPublicKeyId;
  const normalizedRegistered = metadata.publicKey.length === 130 
    ? metadata.publicKey.slice(2) 
    : metadata.publicKey;
  
  if (normalizedSigner.toLowerCase() !== normalizedRegistered.toLowerCase()) {
    return { valid: false, error: 'Signer does not match registered owner' };
  }
  
  return { valid: true };
}
