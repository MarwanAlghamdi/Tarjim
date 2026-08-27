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

/**
 * The whole point of the backend split: a llama.cpp server serves none of
 * Ollama's paths, so before detection every request against one 404'd.
 */
test('detects an OpenAI-compatible server and lists its model', async ({ context, extensionId, llamaStub }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#endpoint')).toHaveValue(/^http:\/\/127\.0\.0\.1:/);

  await page.fill('#endpoint', llamaStub.url);
  await page.click('#test');

  await expect(page.locator('#endpoint-status')).toContainText('OpenAI-compatible server');

  const options = await page.locator('#model option').allTextContents();
  expect(options).toEqual([llamaStub.server.modelId]);
  // No size metadata on /v1/models -- it must not render as "name ()".
  expect(options[0]).not.toContain('()');
});

test('a saved OpenAI-compatible endpoint translates over /v1/chat/completions', async ({ context, extensionId, fixtureUrl, llamaStub }) => {
  const options = await context.newPage();
  await options.goto(optionsUrl(extensionId));
  await expect(options.locator('#endpoint')).toHaveValue(/^http:\/\/127\.0\.0\.1:/);

  await options.fill('#endpoint', llamaStub.url);
  await options.click('#test');
  await expect(options.locator('#endpoint-status')).toContainText('OpenAI-compatible server');
  await options.click('#save');
  await expect(options.locator('#save-status')).toContainText('Saved');
  await options.close();

  const page = await context.newPage();
  await page.goto(fixtureUrl);

  // Select the way a user would, so the browser fires real selection events.
  const box = await page.locator('#english').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  const body = root.locator('.panel-body');
  await expect(body).toContainText('ترجمة', { timeout: 15_000 });
  // The reasoning_content frame the stub emits first must not reach the panel.
  await expect(body).not.toContainText('thinking');

  expect(llamaStub.server.calls.length).toBeGreaterThan(0);
  expect(llamaStub.server.calls.at(-1).messages.at(-1).role).toBe('user');
});
