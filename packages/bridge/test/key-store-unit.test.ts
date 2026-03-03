/**
 * Unit tests for key-store.ts crypto primitives
 *
 * Tests encrypt/decrypt round-trips, dev-mode fallback, and error handling.
 * These run without Prisma — testing only the pure crypto layer
 * (encryptKey/decryptKey read process.env at call-time, so env manipulation works).
 *
 * Run: node --test --experimental-strip-types packages/bridge/test/key-store-unit.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import from the standalone crypto module (no Prisma/metagraph deps)
import {
  encryptKey,
  decryptKey,
  UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH,
  NORMALIZED_PUBLIC_KEY_HEX_LENGTH,
} from '../src/lib/metakit/crypto.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setEncKey(hex: string): void {
  process.env.BRIDGE_KEY_ENCRYPTION_KEY = hex;
}

function clearEncKey(): void {
  delete process.env.BRIDGE_KEY_ENCRYPTION_KEY;
}

// 64 hex chars = 32 bytes (valid AES-256 key)
const VALID_ENC_KEY         = '3c8684fa270ad9e0b4e2b63829e11f49d5ca9f24b66838eb32831cc0de45c62c';
const ANOTHER_VALID_ENC_KEY = '5df9ca345a9c6df163d491f24ebee2046197cef6bbe60fb674c8fa5952b939cc';
const SAMPLE_PRIVATE_KEY = '3cce96fbdbf69cbf38fb68d75aabc7e2e6e4e8b06a72c9f65f5f8b6c7d9a1234';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('encryptKey / decryptKey — round-trip with AES-256-GCM', () => {
  afterEach(() => clearEncKey());

  it('round-trips a private key successfully', () => {
    setEncKey(VALID_ENC_KEY);

    const { encrypted, iv, tag } = encryptKey(SAMPLE_PRIVATE_KEY);
    assert.ok(!encrypted.startsWith('UNENCRYPTED:'), 'Should not use dev-mode marker');
    assert.ok(iv.length > 0, 'IV should be present');
    assert.ok(tag.length === 32, 'Auth tag should be 16 bytes = 32 hex chars');

    const decrypted = decryptKey(encrypted, iv, tag);
    assert.strictEqual(decrypted, SAMPLE_PRIVATE_KEY);
  });

  it('ciphertext does not contain the plaintext key', () => {
    setEncKey(VALID_ENC_KEY);
    const { encrypted } = encryptKey(SAMPLE_PRIVATE_KEY);
    assert.ok(!encrypted.includes(SAMPLE_PRIVATE_KEY), 'Encrypted output must not leak plaintext');
  });

  it('uses a fresh random IV each encryption (non-deterministic)', () => {
    setEncKey(VALID_ENC_KEY);
    const r1 = encryptKey(SAMPLE_PRIVATE_KEY);
    const r2 = encryptKey(SAMPLE_PRIVATE_KEY);
    assert.notStrictEqual(r1.iv, r2.iv, 'Each call should produce a unique IV');
    assert.notStrictEqual(r1.encrypted, r2.encrypted, 'Each call should produce unique ciphertext');
  });

  it('different encryption keys produce different ciphertexts', () => {
    setEncKey(VALID_ENC_KEY);
    const r1 = encryptKey(SAMPLE_PRIVATE_KEY);

    setEncKey(ANOTHER_VALID_ENC_KEY);
    const r2 = encryptKey(SAMPLE_PRIVATE_KEY);

    assert.notStrictEqual(r1.encrypted, r2.encrypted);
  });
});

describe('encryptKey / decryptKey — dev mode (no BRIDGE_KEY_ENCRYPTION_KEY)', () => {
  afterEach(() => clearEncKey());

  it('stores key with UNENCRYPTED: marker when env key absent', () => {
    clearEncKey();
    const key = 'dev-only-private-key';
    const { encrypted, iv, tag } = encryptKey(key);

    assert.ok(encrypted.startsWith('UNENCRYPTED:'), 'Must use dev-mode marker');
    assert.strictEqual(iv, '', 'IV should be empty');
    assert.strictEqual(tag, '', 'Tag should be empty');
  });

  it('decrypts dev-mode UNENCRYPTED: marker correctly (no env key needed)', () => {
    clearEncKey();
    const key = 'dev-only-private-key';
    const { encrypted, iv, tag } = encryptKey(key);

    const decrypted = decryptKey(encrypted, iv, tag);
    assert.strictEqual(decrypted, key);
  });
});

describe('decryptKey — error handling', () => {
  afterEach(() => clearEncKey());

  it('throws on tampered GCM auth tag (integrity violation)', () => {
    setEncKey(VALID_ENC_KEY);
    const { encrypted, iv } = encryptKey(SAMPLE_PRIVATE_KEY);
    const tamperedTag = '00'.repeat(16); // 32 hex chars of zeros

    assert.throws(
      () => decryptKey(encrypted, iv, tamperedTag),
      // Node crypto throws "Unsupported state or unable to authenticate data"
      (err: unknown) => {
        const msg = (err as Error).message ?? '';
        return /Unsupported state|authentication|decrypt/i.test(msg);
      },
      'Should throw when GCM auth tag does not match (tamper detected)'
    );
  });

  it('throws when no encryption key but data is not dev-mode encoded', () => {
    // Simulate: encrypted with a key, but key is gone
    setEncKey(VALID_ENC_KEY);
    const { encrypted, iv, tag } = encryptKey(SAMPLE_PRIVATE_KEY);

    clearEncKey();
    assert.throws(
      () => decryptKey(encrypted, iv, tag),
      /BRIDGE_KEY_ENCRYPTION_KEY not set/,
      'Should throw when env key missing for encrypted (non-dev-mode) data'
    );
  });

  it('throws when encryption key has wrong length', () => {
    setEncKey('tooshort');
    assert.throws(
      () => encryptKey(SAMPLE_PRIVATE_KEY),
      /BRIDGE_KEY_ENCRYPTION_KEY must be 64 hex characters/
    );
  });
});

describe('Public key length constants', () => {
  it('UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH is 130', () => {
    assert.strictEqual(UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH, 130);
  });

  it('NORMALIZED_PUBLIC_KEY_HEX_LENGTH is 128', () => {
    assert.strictEqual(NORMALIZED_PUBLIC_KEY_HEX_LENGTH, 128);
  });

  it('normalized length = uncompressed - 2 (strip 04 prefix)', () => {
    assert.strictEqual(
      UNCOMPRESSED_PUBLIC_KEY_HEX_LENGTH - 2,
      NORMALIZED_PUBLIC_KEY_HEX_LENGTH
    );
  });
});
