import { test as base, chromium, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOllamaStub } from '../stub/ollama-stub.js';
import { createLlamaServerStub } from '../stub/llama-server-stub.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// tools/package.sh sets this so the whole suite runs against the staged
// package rather than the repo -- what ships is then what was tested.
const ROOT = process.env.EXTENSION_DIR
  ? path.resolve(REPO, process.env.EXTENSION_DIR)
  : REPO;
const FIXTURE_DIR = path.join(REPO, 'tests/fixtures');

const SETTINGS = {
  model: 'gemma3:12b',
  keepAlive: '30m',
  maxChunkChars: 1800,
  numCtx: 8192,
  autoPreload: true,
};

/**
 * Fixtures are served over HTTP rather than file://, because Chrome only lets
 * an extension touch file:// URLs after the user manually enables "Allow
 * access to file URLs" -- which cannot be scripted.
 */
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

/**
 * server.close() alone only stops NEW connections -- it then waits for every
 * existing keep-alive socket to go idle and time out, and the browser holds
 * those open for the life of the context, which is torn down after this. That
 * made teardown hang past the test timeout.
 */
function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

async function serviceWorker(context) {
  const [existing] = context.serviceWorkers();
  return existing ?? context.waitForEvent('serviceworker');
}

export const test = base.extend({
  // Override in a test file with `test.use({ cpuOffload: true })`.
  cpuOffload: [false, { option: true }],
  // Refuse any request carrying an Origin, like a default-configured Ollama.
  strictOrigin: [false, { option: true }],
  // Per-token delay; raise it to make an in-flight stream observable.
  streamDelayMs: [5, { option: true }],

  stub: async ({ cpuOffload, streamDelayMs, strictOrigin }, use) => {
    const server = await createOllamaStub({ port: 0, cpuOffload, delayMs: streamDelayMs, strictOrigin });
    await use({ server, url: `http://127.0.0.1:${server.address().port}` });
    await closeServer(server);
  },

  // An OpenAI-compatible server (llama.cpp) alongside the Ollama one, so a
  // test can point the extension at it and prove the dialect switch.
  llamaStub: async ({ streamDelayMs }, use) => {
    const server = await createLlamaServerStub({ port: 0, delayMs: streamDelayMs });
    await use({ server, url: `http://127.0.0.1:${server.address().port}` });
    await closeServer(server);
  },

  fixtureUrl: async ({}, use) => {
    const server = await createStaticServer();
    await use(`http://127.0.0.1:${server.address().port}/page.html`);
    await closeServer(server);
  },

  context: async ({ stub }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Playwright's own Chromium build -- the only one that can side-load an
      // extension headlessly, and free of snap-Brave's AppArmor problems.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${ROOT}`,
        `--load-extension=${ROOT}`,
      ],
    });

    // Point the extension at the stub before any test runs.
    const sw = await serviceWorker(context);
    await sw.evaluate(async ([endpoint, settings]) => {
      await chrome.storage.local.set({ settings: { ...settings, endpoint } });
    }, [stub.url, SETTINGS]);

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const sw = await serviceWorker(context);
    await use(sw.url().split('/')[2]);
  },
});

export { expect, serviceWorker };
