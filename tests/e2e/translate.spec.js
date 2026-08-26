import { test, expect, serviceWorker } from './fixtures.js';

/** Select a paragraph the way a user would, so the browser fires real events. */
async function selectParagraph(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('the extension loads and its service worker starts', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('bubble appears on selection and streams a translation', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const root = page.locator('#ollama-ar-translator-root');
  const bubble = root.locator('.bubble');   // Playwright pierces open shadow roots
  await expect(bubble).toBeHidden();

  await selectParagraph(page, 'english');
  await expect(bubble).toBeVisible();

  await bubble.click();

  const body = root.locator('.panel-body');
  await expect(body).toContainText('ترجمة', { timeout: 15_000 });
  await expect(root.locator('.panel-title')).toContainText('gemma3:12b');
  await expect(root.locator('.btn-copy')).toBeVisible();
});

test('panel renders right-to-left', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'english');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toHaveAttribute('dir', 'rtl');
});

test('selecting text preloads the model before the user clicks', async ({ context, fixtureUrl, stub }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'english');

  // A preload body carries a model but no prompt.
  await expect
    .poll(() => stub.server.calls.filter((c) => c.prompt === undefined).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test('Arabic input is passed through without calling the model', async ({ context, fixtureUrl, stub }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'arabic');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  await expect(root.locator('.status')).toContainText('already Arabic');
  await expect(root.locator('.panel-body')).toContainText('السلام عليكم');
  expect(stub.server.generateCalls()).toHaveLength(0);
});

test('a missing model surfaces an actionable error', async ({ context, fixtureUrl }) => {
  const sw = await serviceWorker(context);
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, model: 'missing:1b' } });
  });

  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'english');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  await expect(root.locator('.status.error')).toContainText('not found');
  await expect(root.locator('.status.error')).toContainText('ollama pull');
  await expect(root.locator('.btn-retry')).toBeVisible();
});

test('Escape closes the panel', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'french');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(root.locator('.panel')).toBeHidden();
});

test.describe('when the model does not fit in VRAM', () => {
  test.use({ cpuOffload: true });

  test('the popup warns that the model is running on the CPU', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

    const warning = page.locator('#perf-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('on the GPU');
    await expect(warning).toContainText('mostly on the CPU');
  });
});
