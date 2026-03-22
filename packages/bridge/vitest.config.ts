import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live in test/ directory
    include: [
      'test/confirmation-registry.test.ts',
      'test/health-metrics.test.ts',
      'test/internal-routes.test.ts',
      'test/key-store-unit.test.ts',
      'test/rejection-api-utilities.test.ts',
      'test/integration-rejection-assertions.test.ts',
      'test/contract-routes.test.ts',
    ],
    // Integration tests excluded from default run (need running services)
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
