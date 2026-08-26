import { test, expect } from './fixtures.js';

/**
 * The gate page exists because chrome.permissions.request() needs transient
 * user activation, which does not survive an `await` and therefore cannot be
 * satisfied from the service worker. Before this page existed, every http(s)
 * PDF failed to open with "This function must be called during a user gesture".
 */
const gateUrl = (id, src) =>
  `chrome-extension://${id}/src/pdf/open.html?src=${encodeURIComponent(src)}`;

test('redirects straight into the viewer when the origin is already granted', async ({ context, extensionId }) => {
  const page = await context.newPage();
  // 127.0.0.1 is in the manifest's host_permissions, so no prompt is needed.
  await page.goto(gateUrl(extensionId, 'http://127.0.0.1:9/doc.pdf'));

  await page.waitForURL(/\/src\/pdfjs\/web\/viewer\.html\?file=/, { timeout: 15_000 });
  expect(decodeURIComponent(page.url())).toContain('http://127.0.0.1:9/doc.pdf');
});

test('asks for permission instead of failing when the origin is not granted', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(gateUrl(extensionId, 'https://arxiv.org/pdf/1706.03762'));

  await expect(page.locator('#grant')).toBeVisible();
  await expect(page.locator('#origin')).toHaveText('https://arxiv.org');
  await expect(page.locator('#target')).toContainText('1706.03762');
  // It must NOT have silently bounced into a viewer that cannot fetch the file.
  expect(page.url()).toContain('/src/pdf/open.html');
});

test('handles a file:// PDF according to the browser\'s file-access setting', async ({ context, extensionId }) => {
  const page = await context.newPage();

  // Chrome gates file:// behind a user-only toggle with no manifest key.
  // Playwright's Chromium enables it for --load-extension, a normal browser
  // does not, so both branches are asserted. Read the capability from a stable
  // page FIRST -- asking after navigating to the gate races its redirect and
  // dies with "Execution context was destroyed".
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  const allowed = await page.evaluate(() => chrome.extension.isAllowedFileSchemeAccess());

  await page.goto(gateUrl(extensionId, 'file:///tmp/doc.pdf'));

  if (allowed) {
    await page.waitForURL(/\/src\/pdfjs\/web\/viewer\.html\?file=/, { timeout: 15_000 });
    expect(decodeURIComponent(page.url())).toContain('file:///tmp/doc.pdf');
  } else {
    await expect(page.locator('#status')).toContainText('File access is disabled');
    await expect(page.locator('#explain')).toContainText('Allow access to file URLs');
  }
});

test('reports a missing or malformed src', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/pdf/open.html`);
  await expect(page.locator('#status')).toContainText('No PDF was specified');
});
