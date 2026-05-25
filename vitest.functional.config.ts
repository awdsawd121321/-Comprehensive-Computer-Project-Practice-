import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    name: 'functional',
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: [
      '*.{test,spec}.tsx',
      'components/**/*.{test,spec}.tsx',
      'src/**/*.test.tsx',
      'src/**/*.spec.tsx',
      'tests/real/**/*.test.ts',
    ],
    exclude: ['tests/system/**', 'node_modules/**', 'dist/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
  },
});

