/**
 * Positive control for the strict-origin stub.
 *
 * The end-to-end test proves the extension gets through a server that refuses
 * extension origins. That proof is worthless if the stub does not actually
 * refuse anything, so this asserts the refusal directly, from plain Node,
 * with no extension involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaStub } from '../stub/ollama-stub.js';

test('the strict stub refuses a POST that carries an Origin', async () => {
  const server = await createOllamaStub({ strictOrigin: true });
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    body: JSON.stringify({ model: 'x', prompt: 'hi' }),
  });

  assert.equal(res.status, 403);
  await new Promise((r) => server.close(r));
});

test('the strict stub allows the same POST once the Origin is gone', async () => {
  const server = await createOllamaStub({ strictOrigin: true });
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'x', prompt: 'hi' }),
  });

  assert.equal(res.status, 200);
  await new Promise((r) => server.close(r));
});
