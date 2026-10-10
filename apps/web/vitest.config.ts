import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror tsconfig paths "@/*" -> apps/web/*. The regex only matches
    // "@/..." so "@fitfusion/*" workspace imports are untouched.
    alias: [{ find: /^@\//, replacement: `${path.resolve(__dirname)}/` }],
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
