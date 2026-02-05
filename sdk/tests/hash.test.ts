import { hash, hashBytes, hashData, computeDigest } from '../src/metakit/hash';

describe('hash', () => {
  describe('hash()', () => {
    it('should return consistent hash for same data', () => {
      const data = { id: 'test', value: 42 };
      const result1 = hash(data);
      const result2 = hash(data);
      expect(result1.value).toBe(result2.value);
    });

    it('should return 64-character hex string', () => {
      const result = hash({ test: 'data' });
      expect(result.value).toHaveLength(64);
      expect(result.value).toMatch(/^[0-9a-f]+$/);
    });

    it('should return 32-byte Uint8Array', () => {
      const result = hash({ test: 'data' });
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.bytes.length).toBe(32);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = hash({ value: 1 });
      const hash2 = hash({ value: 2 });
      expect(hash1.value).not.toBe(hash2.value);
    });
  });

  describe('hashBytes()', () => {
    it('should hash raw bytes', () => {
      const bytes = new TextEncoder().encode('hello world');
      const result = hashBytes(bytes);
      // Known SHA-256 of "hello world"
      expect(result.value).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('should return consistent results', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = hashBytes(bytes);
      const result2 = hashBytes(bytes);
      expect(result1.value).toBe(result2.value);
    });
  });

  describe('hashData()', () => {
    it('should hash data without DataUpdate encoding by default', () => {
      const data = { id: 'test' };
      const result = hashData(data);
      expect(result.value).toBe(hash(data).value);
    });

    it('should apply DataUpdate encoding when specified', () => {
      const data = { id: 'test' };
      const regularHash = hashData(data, false);
      const dataUpdateHash = hashData(data, true);
      // Hashes should be different due to different encoding
      expect(regularHash.value).not.toBe(dataUpdateHash.value);
    });
  });

  describe('computeDigest()', () => {
    it('should return 32-byte digest', () => {
      const data = { id: 'test', value: 42 };
      const digest = computeDigest(data);
      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should produce different digests for DataUpdate vs regular', () => {
      const data = { id: 'test', value: 42 };
      const regularDigest = computeDigest(data, false);
      const dataUpdateDigest = computeDigest(data, true);
      // Convert to hex for comparison
      const regularHex = Buffer.from(regularDigest).toString('hex');
      const dataUpdateHex = Buffer.from(dataUpdateDigest).toString('hex');
      expect(regularHex).not.toBe(dataUpdateHex);
    });

    it('should be deterministic', () => {
      const data = { action: 'test' };
      const digest1 = computeDigest(data);
      const digest2 = computeDigest(data);
      expect(Buffer.from(digest1).toString('hex')).toBe(Buffer.from(digest2).toString('hex'));
    });
  });
});
