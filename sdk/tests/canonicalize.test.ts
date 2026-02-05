import { canonicalize } from '../src/metakit/canonicalize';

describe('canonicalize', () => {
  describe('basic functionality', () => {
    it('should sort object keys alphabetically', () => {
      const result = canonicalize({ b: 2, a: 1 });
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should handle nested objects', () => {
      const result = canonicalize({ b: { d: 4, c: 3 }, a: 1 });
      expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
    });

    it('should handle arrays', () => {
      const result = canonicalize({ arr: [3, 1, 2] });
      // Arrays maintain their order
      expect(result).toBe('{"arr":[3,1,2]}');
    });

    it('should handle strings with special characters', () => {
      const result = canonicalize({ text: 'hello "world"' });
      expect(result).toBe('{"text":"hello \\"world\\""}');
    });

    it('should handle unicode', () => {
      const result = canonicalize({ text: 'caf\u00e9' });
      expect(result).toBe('{"text":"caf\u00e9"}');
    });

    it('should handle null values', () => {
      const result = canonicalize({ a: null, b: 1 });
      expect(result).toBe('{"a":null,"b":1}');
    });

    it('should handle boolean values', () => {
      const result = canonicalize({ active: true, deleted: false });
      expect(result).toBe('{"active":true,"deleted":false}');
    });

    it('should handle numbers', () => {
      const result = canonicalize({ int: 42, float: 3.14, neg: -1 });
      expect(result).toBe('{"float":3.14,"int":42,"neg":-1}');
    });
  });

  describe('edge cases', () => {
    it('should handle empty object', () => {
      const result = canonicalize({});
      expect(result).toBe('{}');
    });

    it('should handle empty array', () => {
      const result = canonicalize([]);
      expect(result).toBe('[]');
    });

    it('should handle deeply nested structures', () => {
      const result = canonicalize({
        level1: {
          level2: {
            level3: { value: 'deep' },
          },
        },
      });
      expect(result).toBe('{"level1":{"level2":{"level3":{"value":"deep"}}}}');
    });

    it('should be deterministic', () => {
      const data = { id: 'test', value: 42, nested: { a: 1, b: 2 } };
      const result1 = canonicalize(data);
      const result2 = canonicalize(data);
      expect(result1).toBe(result2);
    });
  });
});
