import { test, expect } from './fixtures.js';

const optionsUrl = (id) => `chrome-extension://${id}/src/options/options.html`;

test('options page lists usable models and flags reasoning models', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  await page.click('#test');
  await expect(page.locator('#endpoint-status')).toContainText('Connected');

  const options = await page.locator('#model option').allTextContents();
  expect(options.some((o) => o.includes('gemma3:12b'))).toBe(true);
  expect(options.some((o) => o.includes('qwen3:14b') && o.includes('not recommended'))).toBe(true);
  expect(options.some((o) => o.includes('bge-m3'))).toBe(false); // embedding models hidden
});

test('selecting a reasoning model shows the think-leak warning', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await page.click('#test');
  await expect(page.locator('#endpoint-status')).toContainText('Connected');

  await page.selectOption('#model', 'qwen3:14b');
  await expect(page.locator('#model-warning')).toContainText('reasoning');
});

test('a malformed endpoint is rejected before saving', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  // init() populates the field asynchronously; typing before that finishes
  // would be overwritten.
  await expect(page.locator('#endpoint')).toHaveValue(/^http:\/\/127\.0\.0\.1:/);

  await page.fill('#endpoint', 'not a host');
  await page.click('#save');
  await expect(page.locator('#save-status')).toContainText('valid');
});

test('a bare ip:port is normalized on save', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#endpoint')).toHaveValue(/^http:\/\/127\.0\.0\.1:/);

  await page.fill('#endpoint', '127.0.0.1:11434');
  await page.click('#save');
  await expect(page.locator('#save-status')).toContainText('Saved');
  await expect(page.locator('#endpoint')).toHaveValue('http://127.0.0.1:11434');
});
