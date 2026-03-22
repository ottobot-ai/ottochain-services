import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [], // No unit tests yet, all are integration
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
