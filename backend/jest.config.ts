import type { Config } from 'jest';

/**
 * Jest configuration for the P2P Learning backend.
 * - Uses ts-jest preset for TypeScript support without a separate compile step.
 * - Maps @/* path alias so test files can import with the same alias as src/.
 * - globalSetup / globalTeardown run once before/after the entire test suite
 *   (useful for spinning up an in-memory DB or seeding test data).
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  /** Look for tests only under /tests to avoid picking up src files */
  roots: ['<rootDir>/tests'],

  /** Resolve @/ import alias to src/ */
  moduleNameMapper: {
    '^@/config/database$': '<rootDir>/tests/__mocks__/database.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  /**
   * globalSetup runs once before all test suites (single Node process).
   * Use it to connect to a test DB, apply migrations, etc.
   */
  globalSetup: '<rootDir>/tests/globalSetup.ts',

  /**
   * globalTeardown runs once after all test suites complete.
   * Use it to disconnect from the DB, clean up resources, etc.
   */
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',

  /**
   * setupFiles runs BEFORE the test framework is installed and BEFORE modules
   * are imported. This is critical: src/config/env.ts calls parseEnv() at
   * module load time, so process.env must be populated BEFORE any test file
   * imports anything from src/.
   */
  setupFiles: ['<rootDir>/tests/setup.ts'],

  /** Coverage output directory */
  coverageDirectory: 'coverage',

  /** Collect coverage from all src files except the entry point */
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/**/*.d.ts',
    '!src/types/**',
  ],

  /** Fail if coverage thresholds drop below these values */
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  /** Longer timeout for integration tests that hit a real DB */
  testTimeout: 30000,

  /** ts-jest compiler options — match tsconfig.json */
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },

  /** Verbose output shows individual test names */
  verbose: true,
};

export default config;
