import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: path.join(__dirname, 'src/test/integration/globalSetup.ts'),
    setupFiles: [path.join(__dirname, 'src/test/vitest.setup.ts')],
    include: ['src/test/integration/**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Integration test files share one Postgres test database. Running them
    // concurrently lets one file's fixture seed/cleanup race another file's
    // queries (e.g. deleting/inserting shared rows mid-query), causing flaky
    // failures unrelated to the code under test. Force sequential execution.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET || 'vitest-jwt-secret-key-minimum-32-characters-long',
      DB_HOST: process.env.DB_HOST || 'localhost',
      DB_PORT: process.env.DB_PORT || '5434',
      DB_NAME: process.env.DB_NAME || 'klip_test',
      DB_USER: process.env.DB_USER || 'postgres',
      DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
    },
  },
});
