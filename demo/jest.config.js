module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
  testMatch: ['**/*.spec.ts'],
};
