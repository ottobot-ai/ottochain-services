/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Monorepo configuration - run tests in all packages
  projects: [
    '<rootDir>/packages/*/jest.config.js',
    '<rootDir>/packages/*/jest.config.cjs'
  ],
  
  // Collect coverage from all packages
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.d.ts',
    '!packages/*/src/**/*.test.ts',
    '!packages/*/src/**/__tests__/**',
    '!packages/*/node_modules/**'
  ],
  
  // Coverage configuration
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};