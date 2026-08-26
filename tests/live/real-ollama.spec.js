/**
 * Live verification against a REAL Ollama server.
 *
 * Excluded from `npm run verify`; run with `npm run verify:live`.
 * Requires tools/setup-ollama-cors.sh to have been run, and the model pulled.
 */
import { test, expect, ENDPOINT, MODEL } from './fixtures.js';

const ARABIC = /[؀-ۿ]/;

// Timeouts are deliberately generous. If the model does not fit in free VRAM
// Ollama runs it on the CPU at roughly a tenth the speed, and the suite should
// still verify correctness rather than fail as a timeout -- the GPU-split
// preflight above is what reports the slowness.
test.describe.configure({ mode: 'serial', timeout: 600_000 });

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

test('preflight: report how much of the model is on the GPU', async () => {
  // Load the model, then look at where it actually landed. Ollama offloads to
  // CPU silently when free VRAM is short, and the only symptom is a 10-30x
  // slowdown -- which otherwise shows up here as an inexplicable timeout.
  await fetch(`${ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, keep_alive: '30m' }),
  });

  const { models } = await (await fetch(`${ENDPOINT}/api/ps`)).json();
  const mine = models.find((m) => m.name === MODEL);
  if (!mine) {
    console.log(`  ${MODEL} is not resident; cannot report GPU split`);
    return;
  }

  const pct = mine.size ? (mine.size_vram / mine.size) * 100 : 100;
  const line = `  ${MODEL}: ${pct.toFixed(1)}% on GPU `
    + `(${(mine.size_vram / 1e9).toFixed(1)} of ${(mine.size / 1e9).toFixed(1)} GB)`;
  console.log(line);

  if (pct < 50) {
    console.log('  WARNING: mostly on CPU. Expect translations to take minutes, not seconds.');
    console.log('  Check `nvidia-smi` for another process holding VRAM.');
  }
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
    { timeout: 420_000, intervals: [2000] },
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
    { timeout: 420_000, intervals: [2000] },
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
