import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps JSX as `preserve` for Next; without this esbuild falls back to React.createElement and a test that calls a component fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
