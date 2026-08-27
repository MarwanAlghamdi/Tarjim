/**
 * Capture the README screenshots from the REAL extension against REAL Ollama.
 *
 *   node tools/screenshots.mjs
 *
 * Env: OLLAMA_ENDPOINT (default http://localhost:11434), OLLAMA_MODEL
 * (default gemma3:12b).
 *
 * The images are documentation, so they are taken from a live translation
 * rather than the test stub -- a screenshot of "ترجمة تجريبية" would be a
 * screenshot of the test harness, not of the product.
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/images');
const ENDPOINT = process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:12b';
const PROFILE = path.join(process.env.HOME ?? '/tmp', '.cache/tarjim-screenshots');

const DEMO = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tarjim demo</title>
<style>
  body { margin: 0; font: 16px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         color: #18181b; background: #fff; }
  main { max-width: 660px; margin: 0 auto; padding: 56px 32px; }
  h1 { font-size: 25px; margin: 0 0 6px; letter-spacing: -.01em; }
  .meta { color: #71717a; font-size: 14px; margin: 0 0 28px; }
  p { margin: 0 0 18px; }
</style></head>
<body><main>
  <h1>The Voyager 1 Interstellar Mission</h1>
  <p class="meta">Jet Propulsion Laboratory · mission status</p>
  <p id="para">The spacecraft crossed the heliopause in August 2012 and became the first
  human-made object to enter interstellar space. Its plutonium power source loses about
  four watts each year, so instruments are switched off one by one to keep the radio
  transmitter alive.</p>
  <p>Signals now take more than twenty-two hours to reach the Deep Space Network.</p>
</main></body></html>`;

const shot = async (page, file, options) => {
  const target = path.join(OUT, file);
  await page.screenshot({ path: target, ...options });
  const { size } = await fs.stat(target);
  console.log(`  ${file.padEnd(18)} ${(size / 1024).toFixed(0)} KB`);
};

/** Viewport-relative box of a node inside our shadow root. */
function shadowBox(page, selector, pad = 12) {
  return page.evaluate(([sel, p]) => {
    const host = document.getElementById('ollama-ar-translator-root');
    const el = host?.shadowRoot?.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - p),
      y: Math.max(0, r.top - p),
      width: Math.min(innerWidth, r.width + p * 2),
      height: Math.min(innerHeight, r.height + p * 2),
    };
  }, [selector, pad]);
}

async function main() {
  const tags = await fetch(`${ENDPOINT}/api/tags`).catch(() => null);
  if (!tags?.ok) throw new Error(`Ollama is not answering at ${ENDPOINT}`);
  const names = (await tags.json()).models.map((m) => m.name);
  if (!names.includes(MODEL)) throw new Error(`${MODEL} is not installed (have: ${names.length} models)`);

  await fs.mkdir(OUT, { recursive: true });
  await fs.rm(PROFILE, { recursive: true, force: true });

  const server = await new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DEMO);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const demoUrl = `http://127.0.0.1:${server.address().port}/`;

  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    viewport: { width: 1180, height: 760 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  const [sw] = context.serviceWorkers().length
    ? context.serviceWorkers()
    : [await context.waitForEvent('serviceworker')];
  const extensionId = sw.url().split('/')[2];

  await sw.evaluate(async ([endpoint, model]) => {
    await chrome.storage.local.set({
      settings: {
        endpoint, model, backend: 'ollama',
        keepAlive: '30m', maxChunkChars: 1800, numCtx: 8192, autoPreload: true,
      },
    });
  }, [ENDPOINT, MODEL]);

  console.log(`capturing against ${MODEL} at ${ENDPOINT}`);

  /* ---- 1 & 2: bubble on a selection, then the streamed panel ---- */
  const page = await context.newPage();
  await page.goto(demoUrl);

  const box = await page.locator('#para').boundingBox();
  await page.mouse.move(box.x + 2, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 6, { steps: 20 });
  await page.mouse.up();

  const root = page.locator('#ollama-ar-translator-root');
  await root.locator('.bubble').waitFor({ state: 'visible' });
  await shot(page, 'bubble.png', { clip: { x: 0, y: 45, width: 1180, height: 230 } });

  await root.locator('.bubble').click();
  console.log('  waiting for the model (cold load can take ~25s)...');
  await root.locator('.btn-copy').waitFor({ state: 'visible', timeout: 180_000 });
  await page.waitForTimeout(400);

  const panel = await shadowBox(page, '.panel', 16);
  await shot(page, 'panel.png', { clip: panel });
  await shot(page, 'page.png', { clip: { x: 0, y: 20, width: 1180, height: 560 } });

  /* ---- 3: the toolbar popup ---- */
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 364, height: 430 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.locator('#conn-text').filter({ hasText: 'ready' }).waitFor({ timeout: 30_000 });
  await popup.fill('#input', 'Good evening. The library closes at nine.');
  await popup.click('#go');
  await popup.locator('#status').filter({ hasText: 'Done' }).waitFor({ timeout: 180_000 });
  await shot(popup, 'popup.png', { clip: { x: 0, y: 0, width: 364, height: 312 } });

  /* ---- 4: the options page, connected ---- */
  const options = await context.newPage();
  await options.setViewportSize({ width: 760, height: 640 });
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.click('#test');
  await options.locator('#endpoint-status').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await options.selectOption('#model', MODEL).catch(() => {});
  await shot(options, 'options.png', { clip: { x: 0, y: 0, width: 760, height: 470 } });

  /* ---- 5: the bundled PDF.js viewer ---- */
  const pdf = await context.newPage();
  await pdf.setViewportSize({ width: 1180, height: 720 });
  await pdf.goto(`chrome-extension://${extensionId}/src/pdfjs/web/viewer.html`);
  const span = pdf.locator('.textLayer span').first();
  await span.waitFor({ timeout: 60_000 });
  const sbox = await span.boundingBox();
  await pdf.mouse.move(sbox.x + 1, sbox.y + sbox.height / 2);
  await pdf.mouse.down();
  await pdf.mouse.move(sbox.x + sbox.width - 1, sbox.y + sbox.height / 2, { steps: 10 });
  await pdf.mouse.up();
  await pdf.locator('#ollama-ar-translator-root').locator('.bubble').waitFor({ state: 'visible' });
  await shot(pdf, 'pdf.png', { clip: { x: 0, y: 0, width: 1180, height: 470 } });

  await context.close();
  await new Promise((r) => server.close(r));
  console.log(`done -> ${path.relative(ROOT, OUT)}/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
