/**
 * Verify the extension inside the REAL Brave build installed on this machine.
 *
 * The automated suites deliberately use Playwright's bundled Chromium (snap
 * AppArmor and Brave's own flag handling make Brave a poor automation target),
 * so this script exists to confirm the one thing those suites cannot: that the
 * extension actually works in the browser you use.
 *
 *   node tools/verify-brave.mjs          UI flow against a local stub (fast)
 *   node tools/verify-brave.mjs --live   real translation via real Ollama (slow)
 *
 * Env overrides: BRAVE_BIN, OLLAMA_ENDPOINT, OLLAMA_MODEL.
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOllamaStub } from '../tests/stub/ollama-stub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const ENDPOINT = process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:12b';

const BRAVE_CANDIDATES = [
  process.env.BRAVE_BIN,
  '/snap/brave/current/opt/brave.com/brave/brave',
  '/opt/brave.com/brave/brave-browser',
  '/usr/bin/brave-browser',
  '/usr/bin/brave',
].filter(Boolean);

const braveBin = BRAVE_CANDIDATES.find((p) => fs.existsSync(p));
if (!braveBin) {
  console.error('Could not find Brave. Set BRAVE_BIN=/path/to/brave and retry.');
  process.exit(1);
}

// A throwaway profile, kept under $HOME because snap confinement blocks a
// --user-data-dir in /tmp (the browser then dies in a DevToolsActivePort loop).
const UDD = path.join(process.env.HOME, '.cache', 'ollama-ar-brave-verify');
fs.rmSync(UDD, { recursive: true, force: true });

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };

function serveFixture() {
  return new Promise((resolve) => {
    const s = http.createServer(async (_req, res) => {
      const body = await fsp.readFile(path.join(ROOT, 'tests/fixtures/page.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function selectParagraph(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

console.log(`Brave: ${braveBin}`);
console.log(`Mode : ${LIVE ? `LIVE against ${ENDPOINT} (${MODEL})` : 'stubbed Ollama'}\n`);

const site = await serveFixture();
const siteUrl = `http://127.0.0.1:${site.address().port}/page.html`;
const stub = LIVE ? null : await createOllamaStub({ port: 0 });
const endpoint = LIVE ? ENDPOINT : `http://127.0.0.1:${stub.address().port}`;

const ctx = await chromium.launchPersistentContext(UDD, {
  executablePath: braveBin,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  timeout: 60_000,
});

try {
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30_000 });
  const id = sw.url().split('/')[2];
  pass(`extension loaded and service worker running (id ${id})`);

  // Brave Shields and its localhost-access policy could plausibly block this.
  const reach = await sw.evaluate(async (ep) => {
    try {
      const r = await fetch(`${ep}/api/tags`);
      return { status: r.status, count: (await r.json()).models?.length ?? 0 };
    } catch (e) { return { error: String(e) }; }
  }, ENDPOINT);
  if (reach.status === 200) pass(`service worker reached Ollama through Brave (${reach.count} models)`);
  else fail(`service worker could not reach ${ENDPOINT}: ${JSON.stringify(reach)}`);

  await sw.evaluate(async ([ep, model]) => {
    await chrome.storage.local.set({
      settings: { endpoint: ep, model, keepAlive: '30m', maxChunkChars: 1800, numCtx: 8192, autoPreload: true },
    });
  }, [endpoint, MODEL]);

  const page = await ctx.newPage();
  await page.goto(siteUrl);
  const root = page.locator('#ollama-ar-translator-root');
  await root.waitFor({ state: 'attached', timeout: 15_000 });
  pass('content script injected into an ordinary web page');

  await selectParagraph(page, 'english');
  await root.locator('.bubble').waitFor({ state: 'visible', timeout: 15_000 });
  pass('translate bubble appeared on selection');

  await root.locator('.bubble').click();
  const body = root.locator('.panel-body');
  const budget = LIVE ? 420_000 : 30_000;
  if (LIVE) {
    await page.waitForFunction(
      () => /[؀-ۿ]/.test(
        document.getElementById('ollama-ar-translator-root')
          .shadowRoot.querySelector('.panel-body').textContent),
      undefined, { timeout: budget, polling: 2000 },
    );
  } else {
    await body.filter({ hasText: 'ترجمة' }).waitFor({ timeout: budget });
  }
  pass(`translation rendered: ${(await body.textContent()).trim().slice(0, 90)}`);

  // Close the panel first: while open it covers the paragraphs below it, so a
  // drag would land on the panel instead of the text.
  await page.keyboard.press('Escape');
  await root.locator('.panel').waitFor({ state: 'hidden', timeout: 10_000 });

  await selectParagraph(page, 'arabic');
  await root.locator('.bubble').waitFor({ state: 'visible', timeout: 15_000 });
  await root.locator('.bubble').click();
  await root.locator('.status').filter({ hasText: 'already Arabic' }).waitFor({ timeout: 20_000 });
  pass('Arabic selection passed through without a model call');

  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await pop.waitForFunction(
    () => !/Checking/.test(document.getElementById('conn-text').textContent),
    undefined, { timeout: 20_000 },
  );
  pass(`popup reports: ${(await pop.locator('#conn-text').textContent()).trim()}`);

  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${id}/src/options/options.html`);
  await opt.waitForFunction(
    () => document.querySelectorAll('#model option').length > 0
      && document.getElementById('model').value !== '',
    undefined, { timeout: 20_000 },
  );
  pass(`options page listed ${await opt.locator('#model option').count()} usable model(s)`);
} catch (err) {
  fail(err.message.split('\n')[0]);
  // Dump what the widget actually showed -- a bare locator timeout says nothing.
  try {
    const [p] = ctx.pages().filter((pg) => pg.url().startsWith('http://127.0.0.1'));
    if (p) {
      const state = await p.evaluate(() => {
        const host = document.getElementById('ollama-ar-translator-root');
        if (!host) return { host: false };
        const sr = host.shadowRoot;
        return {
          selection: document.getSelection().toString().slice(0, 60),
          bubbleHidden: sr.querySelector('.bubble').hidden,
          panelHidden: sr.querySelector('.panel').hidden,
          status: sr.querySelector('.status').textContent.trim(),
          statusHidden: sr.querySelector('.status').hidden,
          body: sr.querySelector('.panel-body').textContent.trim().slice(0, 120),
        };
      });
      console.log('    widget state: ' + JSON.stringify(state));
    }
  } catch { /* page already gone */ }
} finally {
  await ctx.close();
  stub?.close();
  site.close();
}

console.log(failures === 0 ? '\nAll Brave checks passed.' : `\n${failures} Brave check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
