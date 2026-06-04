import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
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
