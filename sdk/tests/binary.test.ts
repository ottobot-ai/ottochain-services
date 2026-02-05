import { toBytes, encodeDataUpdate } from '../src/metakit/binary';

describe('binary encoding', () => {
  describe('toBytes()', () => {
    it('should encode simple object to UTF-8 bytes', () => {
      const data = { a: 1 };
      const bytes = toBytes(data);
      const decoded = new TextDecoder().decode(bytes);
      expect(decoded).toBe('{"a":1}');
    });

    it('should canonicalize before encoding', () => {
      const data = { b: 2, a: 1 };
      const bytes = toBytes(data);
      const decoded = new TextDecoder().decode(bytes);
      expect(decoded).toBe('{"a":1,"b":2}');
    });

    it('should be deterministic', () => {
      const data = { id: 'test', value: 42 };
      const bytes1 = toBytes(data);
      const bytes2 = toBytes(data);
      expect(Buffer.from(bytes1).toString('hex')).toBe(Buffer.from(bytes2).toString('hex'));
    });

    describe('regular encoding (isDataUpdate=false)', () => {
      it('should return plain UTF-8 bytes', () => {
        const data = { test: 'value' };
        const bytes = toBytes(data, false);
        const decoded = new TextDecoder().decode(bytes);
        expect(decoded).toBe('{"test":"value"}');
      });
    });

    describe('DataUpdate encoding (isDataUpdate=true)', () => {
      it('should include Constellation prefix', () => {
        const data = { test: 'value' };
        const bytes = toBytes(data, true);
        const decoded = new TextDecoder().decode(bytes);
        expect(decoded.startsWith('\x19Constellation Signed Data:\n')).toBe(true);
      });

      it('should base64 encode the canonical JSON', () => {
        const data = { id: 'test' };
        const bytes = toBytes(data, true);
        const decoded = new TextDecoder().decode(bytes);

        // Extract base64 from format: \x19Constellation Signed Data:\n{length}\n{base64}
        const parts = decoded.split('\n');
        expect(parts.length).toBe(3);

        const base64Part = parts[2];
        const decodedBase64 = Buffer.from(base64Part, 'base64').toString('utf-8');
        expect(decodedBase64).toBe('{"id":"test"}');
      });

      it('should include correct length', () => {
        const data = { id: 'test' };
        const bytes = toBytes(data, true);
        const decoded = new TextDecoder().decode(bytes);

        const parts = decoded.split('\n');
        const length = parseInt(parts[1], 10);
        const base64Part = parts[2];
        expect(length).toBe(base64Part.length);
      });
    });
  });

  describe('encodeDataUpdate()', () => {
    it('should be equivalent to toBytes with isDataUpdate=true', () => {
      const data = { action: 'update', value: 123 };
      const bytes1 = toBytes(data, true);
      const bytes2 = encodeDataUpdate(data);
      expect(Buffer.from(bytes1).toString('hex')).toBe(Buffer.from(bytes2).toString('hex'));
    });
  });
});
