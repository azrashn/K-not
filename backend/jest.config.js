/** Three separated suites:
 *  unit         pure logic, no I/O
 *  api          real MySQL 8 + the HTTP app; the Python ai-service is a FAKE (test/support/fake-ai.ts)
 *  integration  real MySQL + the REAL Python ai-service (started by the test; hashing embedder by
 *               default, pinned e5-small with KNOT_REAL_E5=1). Run with `npm run test:integration`. */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'api', testMatch: ['<rootDir>/test/api/**/*.spec.ts'], testTimeout: 30000 },
    { ...base, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'], testTimeout: 600000 },
  ],
};
