/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'monitor',
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/src/**/__tests__/**/*.test.ts'],
  
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
      tsconfig: 'tsconfig.json',
      useESM: false,
    }],
  },
};