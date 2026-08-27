import { describe, it, expect, vi } from 'vitest';
import { jsonResponse } from '../helpers/ndjson.js';
import { sseResponse, delta } from '../helpers/sse.js';
import {
  listModels, listLoadedModels, preloadModel, streamGenerate, buildBody,
} from '../../src/shared/openai.js';
import { detectBackend, clientFor, BACKENDS } from '../../src/shared/backend.js';
import * as ollama from '../../src/shared/ollama.js';
import * as openai from '../../src/shared/openai.js';

const ENDPOINT = 'http://192.168.1.50:8081';

describe('listModels', () => {
  it('reads the OpenAI /v1/models envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      object: 'list',
      data: [{ id: 'unsloth/Qwen3-27B-GGUF:UD-Q4_K_M', object: 'model' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await listModels(`${ENDPOINT}/`);

    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/v1/models`);
    expect(models).toEqual([{
      name: 'unsloth/Qwen3-27B-GGUF:UD-Q4_K_M',
      capabilities: [],
      parameterSize: '',
      isThinking: false,
      isEmbedding: false,
    }]);
  });

  it('raises an offline error when nothing is listening', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('does not claim a CORS problem on 403 the way the Ollama client does', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('streamGenerate', () => {
  it('accumulates delta.content and reports the final metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      delta(' صباح'),
      delta(' الخير'),
      { ...delta(null, 'stop'), usage: { completion_tokens: 7 } },
    ])));

    const tokens = [];
    const result = await streamGenerate(ENDPOINT, { model: 'x' }, { onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual([' صباح', ' الخير']);
    expect(result.text).toBe(' صباح الخير');
    expect(result.doneReason).toBe('stop');
    expect(result.evalCount).toBe(7);
  });

  it('reassembles an SSE frame split across two network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse([delta('الطقس'), delta(' جميل'), delta(null, 'stop')], { splitAt: 25 }),
    ));
    const result = await streamGenerate(ENDPOINT, { model: 'x' });
    expect(result.text).toBe('الطقس جميل');
  });

  it('ignores [DONE], keep-alive comments and malformed frames', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(': ping\n\n'));
        c.enqueue(encoder.encode(`data: ${JSON.stringify(delta('ok'))}\n\n`));
        c.enqueue(encoder.encode('data: {not json at all}\n\n'));
        c.enqueue(encoder.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const result = await streamGenerate(ENDPOINT, { model: 'x' });
    expect(result.text).toBe('ok');
  });

  it('drops reasoning_content so a thinking model does not leak <think> text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { reasoning_content: 'The user wants Arabic…' } }] },
      delta('مرحبا'),
      delta(null, 'stop'),
    ])));

    const result = await streamGenerate(ENDPOINT, { model: 'x' });
    expect(result.text).toBe('مرحبا');
  });

  it('surfaces an error frame sent mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse([{ error: { message: 'context shift disabled' } }], { done: false }),
    ));
    await expect(streamGenerate(ENDPOINT, { model: 'x' }))
      .rejects.toMatchObject({ kind: 'http', message: 'context shift disabled' });
  });

  it('reads the nested OpenAI error envelope on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'model not found', code: 404 } }),
      { status: 404 },
    )));
    await expect(streamGenerate(ENDPOINT, { model: 'nope' }))
      .rejects.toMatchObject({ kind: 'model-missing', message: 'model not found' });
  });

  it('maps an aborted request to kind "aborted"', async () => {
    const err = new DOMException('The user aborted a request.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    await expect(streamGenerate(ENDPOINT, { model: 'x' })).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('buildBody', () => {
  it('produces a chat-completions body with the system prompt', () => {
    const body = buildBody({ model: 'qwen3', text: 'Good evening.' });

    expect(body.stream).toBe(true);
    expect(body.model).toBe('qwen3');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Good evening.' });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});

describe('Ollama-only diagnostics degrade quietly', () => {
  it('reports no resident models and never preloads', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await listLoadedModels(ENDPOINT)).toEqual([]);
    expect(await preloadModel(ENDPOINT, 'x')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('detectBackend', () => {
  const ok = () => new Response('{}', { status: 200 });
  const notFound = () => new Response('not found', { status: 404 });

  it('prefers Ollama, which also answers /v1/models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    expect(await detectBackend(ENDPOINT)).toBe(BACKENDS.OLLAMA);
  });

  it('detects a llama-server, where /api/tags does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (url.endsWith('/api/tags') ? notFound() : ok())));
    expect(await detectBackend(ENDPOINT)).toBe(BACKENDS.OPENAI);
  });

  it('returns null when nothing answers, so a stored backend is not overwritten', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await detectBackend(ENDPOINT)).toBe(null);
  });
});

describe('clientFor', () => {
  it('routes by settings.backend and defaults to Ollama', () => {
    expect(clientFor({ backend: 'openai' })).toBe(openai);
    expect(clientFor({ backend: 'ollama' })).toBe(ollama);
    expect(clientFor({})).toBe(ollama);
    expect(clientFor(undefined)).toBe(ollama);
  });
});
