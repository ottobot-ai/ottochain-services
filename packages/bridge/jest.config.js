/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'bridge',
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  
  // Source and coverage paths
  roots: ['<rootDir>/src', '<rootDir>/test'],
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