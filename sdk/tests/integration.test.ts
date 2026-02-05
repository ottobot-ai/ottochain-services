/**
 * Integration tests for the full signing workflow
 *
 * Note: These tests require dag4js which needs to be installed.
 * Some tests may be skipped in environments where dag4js is not available.
 */

import {
  generateKeyPair,
  keyPairFromPrivateKey,
  createSignedObject,
  addSignature,
  batchSign,
  verify,
  sign,
  signDataUpdate,
  verifySignature,
  isValidPrivateKey,
  isValidPublicKey,
} from '../src';

// Check if dag4 is available
let dag4Available = false;
try {
  require('@stardust-collective/dag4');
  dag4Available = true;
} catch {
  dag4Available = false;
}

const describeWithDag4 = dag4Available ? describe : describe.skip;

describeWithDag4('Integration tests', () => {
  describe('Key generation', () => {
    it('should generate valid key pair', () => {
      const keyPair = generateKeyPair();

      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.address).toBeDefined();

      expect(isValidPrivateKey(keyPair.privateKey)).toBe(true);
      expect(isValidPublicKey(keyPair.publicKey)).toBe(true);
      expect(keyPair.address).toMatch(/^DAG/);
    });

    it('should derive same key pair from same private key', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = keyPairFromPrivateKey(keyPair1.privateKey);

      expect(keyPair2.publicKey).toBe(keyPair1.publicKey);
      expect(keyPair2.address).toBe(keyPair1.address);
    });
  });

  describe('Signing workflow', () => {
    let keyPair: ReturnType<typeof generateKeyPair>;

    beforeAll(() => {
      keyPair = generateKeyPair();
    });

    describe('Regular signing', () => {
      it('should sign and verify data', async () => {
        const data = { action: 'test', value: 42 };
        const proof = await sign(data, keyPair.privateKey);

        expect(proof.id).toBeDefined();
        expect(proof.signature).toBeDefined();
        expect(proof.id.length).toBe(128); // Without 04 prefix

        const isValid = await verifySignature(data, proof, false);
        expect(isValid).toBe(true);
      });

      it('should create signed object', async () => {
        const data = { action: 'test', value: 123 };
        const signed = await createSignedObject(data, keyPair.privateKey);

        expect(signed.value).toEqual(data);
        expect(signed.proofs.length).toBe(1);

        const result = await verify(signed, false);
        expect(result.isValid).toBe(true);
        expect(result.validProofs.length).toBe(1);
        expect(result.invalidProofs.length).toBe(0);
      });
    });

    describe('DataUpdate signing', () => {
      it('should sign and verify DataUpdate', async () => {
        const data = { action: 'update', payload: { key: 'value' } };
        const proof = await signDataUpdate(data, keyPair.privateKey);

        expect(proof.id).toBeDefined();
        expect(proof.signature).toBeDefined();

        const isValid = await verifySignature(data, proof, true);
        expect(isValid).toBe(true);
      });

      it('should create signed DataUpdate object', async () => {
        const data = { action: 'update', value: 999 };
        const signed = await createSignedObject(data, keyPair.privateKey, {
          isDataUpdate: true,
        });

        expect(signed.value).toEqual(data);
        expect(signed.proofs.length).toBe(1);

        const result = await verify(signed, true);
        expect(result.isValid).toBe(true);
      });
    });

    describe('Multi-signature', () => {
      it('should add signature to existing signed object', async () => {
        const keyPair2 = generateKeyPair();
        const data = { action: 'multi-sig', value: 'test' };

        // First signature
        let signed = await createSignedObject(data, keyPair.privateKey);
        expect(signed.proofs.length).toBe(1);

        // Add second signature
        signed = await addSignature(signed, keyPair2.privateKey);
        expect(signed.proofs.length).toBe(2);

        // Both proofs should be valid
        const result = await verify(signed, false);
        expect(result.isValid).toBe(true);
        expect(result.validProofs.length).toBe(2);
      });

      it('should batch sign with multiple keys', async () => {
        const keyPair2 = generateKeyPair();
        const keyPair3 = generateKeyPair();
        const data = { action: 'batch', value: 'test' };

        const signed = await batchSign(data, [
          keyPair.privateKey,
          keyPair2.privateKey,
          keyPair3.privateKey,
        ]);

        expect(signed.proofs.length).toBe(3);

        const result = await verify(signed, false);
        expect(result.isValid).toBe(true);
        expect(result.validProofs.length).toBe(3);
      });
    });

    describe('Tamper detection', () => {
      it('should detect modified data', async () => {
        const data = { action: 'test', value: 42 };
        const signed = await createSignedObject(data, keyPair.privateKey);

        // Modify the data
        const tampered = {
          ...signed,
          value: { action: 'test', value: 999 },
        };

        const result = await verify(tampered, false);
        expect(result.isValid).toBe(false);
        expect(result.invalidProofs.length).toBe(1);
      });

      it('should detect wrong signing mode', async () => {
        const data = { action: 'test', value: 42 };
        // Sign as regular
        const signed = await createSignedObject(data, keyPair.privateKey, {
          isDataUpdate: false,
        });

        // Verify as DataUpdate (should fail)
        const result = await verify(signed, true);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Error handling', () => {
    it('should throw on invalid key for batchSign', async () => {
      await expect(batchSign({ test: 1 }, [])).rejects.toThrow('At least one private key');
    });
  });
});
