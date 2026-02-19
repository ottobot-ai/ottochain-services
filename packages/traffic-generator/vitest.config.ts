import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude integration tests (standalone scripts meant to run against real clusters)
    // These are run separately in CI against a live cluster, not via vitest
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude standalone integration test scripts (run with npx tsx, not vitest)
      'test/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      exclude: [
        'coverage/**',
        'dist/**',
        'node_modules/**',
        '**/*.d.ts',
        '**/*.config.*',
        'test/**',
      ],
    },
  },
});