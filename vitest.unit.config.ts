import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: [
      'utils/**/*.{test,spec}.ts',
      'services/**/*.{test,spec}.ts',
      'backend/**/*.{test,spec}.{ts,js}',
      'openclaw/**/*.{test,spec}.{ts,js}',
    ],
    exclude: [
      '**/*.{test,spec}.tsx',
      'tests/**',
      'node_modules/**',
      'dist/**',
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
