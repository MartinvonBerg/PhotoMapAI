export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  moduleNameMapper: { 
    '^electron$': '<rootDir>/tests/__mocks__/electron.js' },

  collectCoverage: true,
  collectCoverageFrom: ['aitagging/**/*.js'],
  //collectCoverageFrom: ['src/**/*.js', 'aitagging/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 85, statements: 85 }
  }
};