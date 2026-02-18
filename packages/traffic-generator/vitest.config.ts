import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude integration tests (standalone scripts meant to run against real clusters)
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/integration.test.ts',
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