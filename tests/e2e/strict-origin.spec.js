import { test, expect } from './fixtures.js';

/**
 * The reason this extension no longer ships a sudo script.
 *
 * Chrome omits Origin on a GET from an extension but always attaches
 * `Origin: chrome-extension://<id>` to a POST. Ollama's default configuration
 * rejects that header with 403, so listing models worked and every translation
 * failed. src/shared/origin-rule.js removes the header with a
 * declarativeNetRequest rule scoped to the configured endpoint.
 *
 * The stub here refuses ANY request carrying an Origin.
 * tests/unit/strict-stub.control.mjs proves it really does refuse.
 */
test.use({ strictOrigin: true });

test('translates through a server that refuses extension origins', async ({ context, fixtureUrl, stub }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const box = await page.locator('#english').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  await expect(root.locator('.panel-body')).toContainText('ترجمة', { timeout: 20_000 });

  // Not just "it worked": the header must actually be absent on the wire.
  expect(stub.server.origins.length).toBeGreaterThan(0);
  expect(stub.server.origins.filter(Boolean)).toEqual([]);
});

test('picks a model on its own when none is saved', async ({ context, fixtureUrl }) => {
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, model: '' } });
  });

  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const box = await page.locator('#english').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toContainText('ترجمة', { timeout: 20_000 });

  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.model);
  expect(saved).toBeTruthy();
});
