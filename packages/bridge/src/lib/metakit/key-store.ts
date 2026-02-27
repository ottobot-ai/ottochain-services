/**
 * Key Store for Server-Signed Mode
 * 
 * Stores private keys for agents registered in server-signed mode.
 * Phase 1: In-memory storage (keys lost on restart)
 * Phase 2: Encrypted database backing (TODO)
 */

import { generateKeyPair, keyPairFromPrivateKey } from '../../metagraph.js';
import type { KeyPair } from '../../metagraph.js';

/**
 * Key store interface for managing server-stored keys.
 * Allows swapping implementations (memory → database).
 */
export interface KeyStore {
  /**
   * Get the private key for a fiber.
   * Returns undefined if not found or if fiber uses self-signed mode.
   */
  get(fiberId: string): Promise<string | undefined>;
  
  /**
   * Store a private key for a fiber.
   */
  set(fiberId: string, privateKey: string): Promise<void>;
  
  /**
   * Delete the key for a fiber (e.g., on deregistration).
   */
  delete(fiberId: string): Promise<void>;
  
  /**
   * Check if a fiber has a stored key.
   */
  has(fiberId: string): Promise<boolean>;
  
  /**
   * Get the signing mode for a fiber.
   */
  getMode(fiberId: string): Promise<SigningMode | undefined>;
  
  /**
   * Set metadata for a fiber (signing mode, public key for self-signed).
   */
  setMetadata(fiberId: string, metadata: FiberKeyMetadata): Promise<void>;
  
  /**
   * Get metadata for a fiber.
   */
  getMetadata(fiberId: string): Promise<FiberKeyMetadata | undefined>;
}

export type SigningMode = 'server' | 'self';

export interface FiberKeyMetadata {
  signingMode: SigningMode;
  publicKey: string;
  address: string;
  createdAt: Date;
}

/**
 * Maximum number of entries in the in-memory store.
 * Prevents unbounded memory growth.
 */
const MAX_ENTRIES = 10_000;

/**
 * In-memory key store implementation.
 * 
 * ⚠️ Keys are lost on process restart!
 * This is acceptable for development/staging but not production.
 * 
 * ⚠️ Single-instance only!
 * Multiple bridge instances would have separate stores.
 * For HA, use Redis or database backing.
 */
class InMemoryKeyStore implements KeyStore {
  private keys = new Map<string, string>();
  private metadata = new Map<string, FiberKeyMetadata>();
  
  async get(fiberId: string): Promise<string | undefined> {
    return this.keys.get(fiberId);
  }
  
  async set(fiberId: string, privateKey: string): Promise<void> {
    this.evictIfNeeded();
    this.keys.set(fiberId, privateKey);
  }
  
  async delete(fiberId: string): Promise<void> {
    this.keys.delete(fiberId);
    this.metadata.delete(fiberId);
  }
  
  async has(fiberId: string): Promise<boolean> {
    return this.keys.has(fiberId);
  }
  
  async getMode(fiberId: string): Promise<SigningMode | undefined> {
    return this.metadata.get(fiberId)?.signingMode;
  }
  
  async setMetadata(fiberId: string, metadata: FiberKeyMetadata): Promise<void> {
    this.evictIfNeeded();
    this.metadata.set(fiberId, metadata);
  }
  
  async getMetadata(fiberId: string): Promise<FiberKeyMetadata | undefined> {
    return this.metadata.get(fiberId);
  }
  
  /**
   * Evict oldest entries if at capacity.
   * Uses Map's insertion order for FIFO eviction.
   */
  private evictIfNeeded(): void {
    while (this.keys.size >= MAX_ENTRIES) {
      const oldest = this.keys.keys().next().value;
      if (oldest) {
        console.log(`[key-store] Evicting ${oldest} (at capacity)`);
        this.keys.delete(oldest);
        this.metadata.delete(oldest);
      } else {
        break;
      }
    }
  }
}

// Singleton instance
const keyStoreInstance = new InMemoryKeyStore();

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
 * Generates a keypair and stores it in the key store.
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
 * Stores the public key for signature validation.
 */
export async function registerSelfSigned(
  fiberId: string,
  publicKey: string
): Promise<SelfKeyRegistration> {
  // Derive address from public key
  // dag4 expects 130-char key with 04 prefix
  const fullPublicKey = publicKey.length === 128 ? `04${publicKey}` : publicKey;
  const keyPair = {
    privateKey: '', // Not stored for self-signed
    publicKey: fullPublicKey,
    address: '', // Will be derived below
  };
  
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
