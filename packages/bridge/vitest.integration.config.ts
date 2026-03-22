import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/e2e.test.ts',
      'test/lifecycle.test.ts',
      'test/client-signing.test.ts',
      'test/cloud-agent-integration.test.ts',
      'test/sm.test.ts',
      'test/rejection-verification.test.ts',
      'test/multi-dl1-submission.test.ts',
      'test/sequence-cache.test.ts',
    ],
  },
});
