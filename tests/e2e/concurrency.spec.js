import { test, expect } from './fixtures.js';

// Slow the stream down so the first translation is provably still in flight
// when the second starts. That deliberate stalling needs a longer budget than
// the 30s default.
test.use({ streamDelayMs: 500 });
test.describe.configure({ timeout: 120_000 });

/**
 * Drag-select a paragraph.
 *
 * Never re-drag text that is already selected: mousedown inside an existing
 * selection starts a native text drag-and-drop, which swallows mouseup
 * entirely (observed as mousedown=1, mouseup=0, selectionchange=0) and
 * selects nothing. Always target a different element, or collapse the
 * selection with a click first.
 */
async function selectParagraph(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('a second translation supersedes the first instead of interleaving', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  // Two-column fixture: the panel opens under the left paragraph and cannot
  // cover the right one, so both selections stay clickable.
  await page.goto(fixtureUrl.replace('page.html', 'concurrency.html'));

  const root = page.locator('#ollama-ar-translator-root');
  const body = root.locator('.panel-body');

  // Start on the English paragraph and wait until it is genuinely mid-stream.
  await selectParagraph(page, 'english');
  await root.locator('.bubble').click();
  await expect(body).toContainText('ترجمة', { timeout: 15_000 });

  // Now start a different one while the first is still streaming.
  await selectParagraph(page, 'french');
  await root.locator('.bubble').click();

  // The stub tags each response with its prompt, so interleaving is visible.
  await expect(body).toContainText('[Le chat noir', { timeout: 20_000 });
  await expect(body).not.toContainText('[The committee');
});

test('Stop halts the stream and nothing further is appended', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const root = page.locator('#ollama-ar-translator-root');
  const body = root.locator('.panel-body');

  await selectParagraph(page, 'english');
  await root.locator('.bubble').click();
  await expect(body).toContainText('ترجمة', { timeout: 15_000 });

  await root.locator('.btn-cancel').click();
  await expect(root.locator('.status')).toContainText('Cancelled');

  const frozen = await body.textContent();
  await page.waitForTimeout(2500);   // longer than several stub token intervals
  expect(await body.textContent()).toBe(frozen);
});

test('closing the panel cancels the run in flight', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const root = page.locator('#ollama-ar-translator-root');
  await selectParagraph(page, 'english');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toContainText('ترجمة', { timeout: 15_000 });

  await page.keyboard.press('Escape');
  await expect(root.locator('.panel')).toBeHidden();

  // The next translation must actually SUCCEED. Asserting only that the old
  // text is absent is tautological -- a panel stuck on "Translating..." with an
  // empty body passes that too, which is exactly how a real regression (both
  // sides minting their own run ids) slipped through.
  await page.waitForTimeout(2000);
  await selectParagraph(page, 'french');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toContainText('[Le chat noir', { timeout: 20_000 });
  await expect(root.locator('.panel-body')).not.toContainText('[The committee');
});
