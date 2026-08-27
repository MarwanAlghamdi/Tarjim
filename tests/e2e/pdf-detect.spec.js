import { test, expect } from './fixtures.js';

/**
 * Regression: the "open in the translator viewer" button was gated on a ".pdf"
 * suffix in the URL, so it silently never appeared for
 * https://arxiv.org/pdf/2109.14279 and every other PDF served from a path
 * without an extension.
 *
 * The fixture serves a genuine application/pdf at "/paper".
 */
const pdfUrl = (fixtureUrl) => fixtureUrl.replace('page.html', 'paper');

/**
 * Run against the real module, from an extension page.
 *
 * A service worker cannot use dynamic import() -- the HTML spec forbids it --
 * so the options page stands in as a host that has the same `scripting` and
 * host permissions the popup does.
 */
async function probe(context, extensionId, url) {
  const host = await context.newPage();
  await host.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  const result = await host.evaluate(async (u) => {
    const { tabIsPdf, looksLikePdfUrl } = await import(chrome.runtime.getURL('src/shared/pdf.js'));
    const [tab] = await chrome.tabs.query({ url: u });
    if (!tab) return { error: 'tab not found' };
    return { byUrl: looksLikePdfUrl(tab.url), byContentType: await tabIsPdf(tab.id, tab.url) };
  }, url);
  await host.close();
  return result;
}

test('detects a PDF served without a .pdf extension', async ({ context, extensionId, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(pdfUrl(fixtureUrl)).catch(() => { /* Chrome may swap to its viewer */ });
  await page.waitForTimeout(1200);

  const result = await probe(context, extensionId, pdfUrl(fixtureUrl));

  expect(result.byUrl).toBe(false);          // what the old gate saw
  expect(result.byContentType).toBe(true);   // what the tab actually is
});

test('does not mistake an ordinary page for a PDF', async ({ context, extensionId, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  const result = await probe(context, extensionId, fixtureUrl);

  expect(result.byUrl).toBe(false);
  expect(result.byContentType).toBe(false);
});

test('opens an extensionless PDF in the bundled viewer and translates a selection', async ({ context, extensionId, fixtureUrl }) => {
  const src = pdfUrl(fixtureUrl);
  const page = await context.newPage();

  // The same route the toolbar button takes: permission gate, then the viewer.
  await page.goto(
    `chrome-extension://${extensionId}/src/pdf/open.html?src=${encodeURIComponent(src)}`,
  );

  await expect(page).toHaveURL(/src\/pdfjs\/web\/viewer\.html/, { timeout: 20_000 });

  const span = page.locator('.textLayer span').first();
  await expect(span).toBeAttached({ timeout: 30_000 });

  const box = await span.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toContainText('ترجمة', { timeout: 20_000 });
});
