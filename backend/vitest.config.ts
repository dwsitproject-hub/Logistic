import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // *.integration.test.ts also matches the glob above, but those tests do real DB writes
    // (SapMasterV2ImportService.importMasterV2File, real cancel/HTTP calls) and only get a safe
    // isolated database (klip_test on port 5434) via vitest.integration.config.ts's env block and
    // its globalSetup migrate/seed step. Running them through this default config falls back to
    // backend/.env's real dev DB_PORT/DB_NAME (klip_db, the same database manual testing and the
    // running klip-backend container use) - discovered 2026-09-03 when a plain `npx vitest run`
    // left real test fixture rows (ITEST-*, ITRK-*) sitting in the dev database. Excluded here so
    // `npm test` / a bare `npx vitest run` can never do this again; use `npm run test:integration`
    // for these files instead.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', 'src/test/integration/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
    },
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'vitest-jwt-secret-key-minimum-32-characters-long',
    },
  },
});
