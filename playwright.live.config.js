import { defineConfig } from '@playwright/test';

// Live suite: runs against a REAL Ollama server, so timeouts allow for a cold
// model load. Kept out of the default config so `npm run verify` stays hermetic.
export default defineConfig({
  testDir: './tests/live',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
