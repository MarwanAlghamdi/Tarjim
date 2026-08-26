import { test, expect } from './fixtures.js';

const viewerUrl = (id) => `chrome-extension://${id}/src/pdfjs/web/viewer.html`;

test('the bundled PDF.js viewer loads and hosts the translator UI', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(viewerUrl(extensionId));

  // PDF.js booted ...
  await expect(page.locator('#viewerContainer')).toBeAttached();
  // ... and our content scripts were injected by viewer.html, not the manifest.
  await expect(page.locator('#ollama-ar-translator-root')).toBeAttached();
});

test('text selected inside the PDF viewer triggers the translate bubble', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(viewerUrl(extensionId));

  // Wait for PDF.js to render its selectable text layer over the canvas.
  const span = page.locator('.textLayer span').first();
  await expect(span).toBeAttached({ timeout: 20_000 });

  const box = await span.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await expect(root.locator('.bubble')).toBeVisible({ timeout: 10_000 });

  await root.locator('.bubble').click();
  await expect(root.locator('.panel-body')).toContainText('ترجمة', { timeout: 15_000 });
});
