import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 60s rather than the 30s default: this machine's GPU is often saturated by
  // other work, and a loaded box was observed timing out during fixture
  // teardown rather than on any real assertion.
  timeout: 60_000,
  fullyParallel: false,   // one persistent context loads the extension
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
