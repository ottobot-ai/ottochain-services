/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'bridge',
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test file patterns - only unit tests in src/__tests__/
  // Integration tests in test/ require a running bridge service and should be run separately
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  
  // Source and coverage paths
  roots: ['<rootDir>/src'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**'
  ],
  
  // Module resolution
  moduleFileExtensions: ['ts', 'js', 'json'],
  
  // Transform configuration
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2022',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      useESM: false,
    }],
  },
  
  // Handle ES module imports
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};