import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/rejections-migration.test.ts',
      'test/rejections-signer-filter.test.ts',
      'test/rejections-timestamp-filter.test.ts',
    ],
  },
});
