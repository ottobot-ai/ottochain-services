import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testMatch: ['src/**/*.test.{ts,js}'],
  },
})