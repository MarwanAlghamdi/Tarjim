/**
 * Live verification against a REAL Ollama server.
 *
 * Excluded from `npm run verify`; run with `npm run verify:live`.
 * Requires tools/setup-ollama-cors.sh to have been run, and the model pulled.
 */
import { test, expect, ENDPOINT, MODEL } from './fixtures.js';

const ARABIC = /[؀-ۿ]/;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function selectParagraph(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('preflight: Ollama accepts a chrome-extension origin and has the model', async () => {
  const res = await fetch(`${ENDPOINT}/api/tags`, {
    headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
  });
  expect(res.status,
    `Ollama answered ${res.status} to a chrome-extension origin. Run: sudo tools/setup-ollama-cors.sh`,
  ).toBe(200);

  const { models } = await res.json();
  expect(models.map((m) => m.name), `Model ${MODEL} is not installed. Run: ollama pull ${MODEL}`)
    .toContain(MODEL);
});

test('English selection is translated to Arabic by the real model', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'english');

  const root = page.locator('#ollama-ar-translator-root');
  await expect(root.locator('.bubble')).toBeVisible();
  await root.locator('.bubble').click();

  // Generous: covers a cold model load plus the automatic single retry.
  await expect.poll(
    async () => ARABIC.test(await root.locator('.panel-body').textContent()),
    { timeout: 150_000, intervals: [1000] },
  ).toBe(true);

  await expect(root.locator('.panel-title')).toContainText(MODEL);
  console.log('  translated ->', (await root.locator('.panel-body').textContent()).trim());
});

test('a non-English source language also lands in Arabic', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'french');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  await expect.poll(
    async () => ARABIC.test(await root.locator('.panel-body').textContent()),
    { timeout: 120_000, intervals: [1000] },
  ).toBe(true);
  console.log('  french ->', (await root.locator('.panel-body').textContent()).trim());
});

test('Arabic selection is passed through unchanged, with no model call', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await selectParagraph(page, 'arabic');

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();

  await expect(root.locator('.status')).toContainText('already Arabic', { timeout: 15_000 });
  await expect(root.locator('.panel-body')).toContainText('السلام عليكم');
});
