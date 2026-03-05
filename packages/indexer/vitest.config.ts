import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run vitest-specific tests (snapshot indexer unit tests)
    // Integration tests (rejections-*.test.ts) use node:test runner
    include: ['test/snapshot-indexer.test.ts'],
  },
});
