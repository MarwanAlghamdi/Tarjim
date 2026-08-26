import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/unit/dom/**', 'jsdom']],
    setupFiles: ['./tests/setup.js'],
    globals: true,
    include: ['tests/unit/**/*.test.js'],
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
