import { test as base, chromium, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(ROOT, 'tests/fixtures');

/** The real server, overridable: OLLAMA_ENDPOINT=192.168.1.50:11434 npm run verify:live */
export const ENDPOINT = process.env.OLLAMA_ENDPOINT
  ? (process.env.OLLAMA_ENDPOINT.includes('://')
      ? process.env.OLLAMA_ENDPOINT
      : `http://${process.env.OLLAMA_ENDPOINT}`)
  : 'http://localhost:11434';

export const MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:12b';

function createStaticServer() {
  const server = http.createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname) || 'page.html';
    try {
      const body = await fs.readFile(path.join(FIXTURE_DIR, name));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function serviceWorker(context) {
  const [existing] = context.serviceWorkers();
  return existing ?? context.waitForEvent('serviceworker');
}

export const test = base.extend({
  fixtureUrl: async ({}, use) => {
    const server = await createStaticServer();
    await use(`http://127.0.0.1:${server.address().port}/page.html`);
    await new Promise((r) => server.close(r));
  },

  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    });

    const sw = await serviceWorker(context);
    await sw.evaluate(async ([endpoint, model]) => {
      await chrome.storage.local.set({
        settings: {
          endpoint, model, keepAlive: '30m',
          maxChunkChars: 1800, numCtx: 8192, autoPreload: true,
        },
      });
    }, [ENDPOINT, MODEL]);

    await use(context);
    await context.close();
  },
});

export { expect, serviceWorker };
