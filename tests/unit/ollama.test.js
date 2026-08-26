import { describe, it, expect, vi } from 'vitest';
import { ndjsonResponse, jsonResponse } from '../helpers/ndjson.js';
import { listModels, listLoadedModels, preloadModel, streamGenerate, OllamaError } from '../../src/shared/ollama.js';

const ENDPOINT = 'http://localhost:11434';

describe('listModels', () => {
  it('flags embedding and thinking models from capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      models: [
        { name: 'gemma3:12b', capabilities: ['completion'], details: { parameter_size: '12.2B' } },
        { name: 'qwen3:14b', capabilities: ['completion', 'tools', 'thinking'], details: { parameter_size: '14.8B' } },
        { name: 'bge-m3:latest', capabilities: ['embedding'], details: { parameter_size: '566.70M' } },
      ],
    })));

    const models = await listModels(ENDPOINT);
    expect(models.map((m) => m.name)).toEqual(['gemma3:12b', 'qwen3:14b', 'bge-m3:latest']);
    expect(models[0]).toMatchObject({ isThinking: false, isEmbedding: false, parameterSize: '12.2B' });
    expect(models[1].isThinking).toBe(true);
    expect(models[2].isEmbedding).toBe(true);
  });

  it('raises an offline error when the endpoint refuses the connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('raises a cors error on 403 -- the pre-setup Ollama response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: 'cors' });
  });
});

describe('streamGenerate', () => {
  it('accumulates tokens and reports the final metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      { response: ' صباح', done: false },
      { response: ' الخير', done: false },
      { response: '', done: true, done_reason: 'stop', eval_count: 7 },
    ])));

    const tokens = [];
    const result = await streamGenerate(ENDPOINT, { model: 'x' }, { onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual([' صباح', ' الخير']);
    expect(result.text).toBe(' صباح الخير');
    expect(result.doneReason).toBe('stop');
    expect(result.evalCount).toBe(7);
  });

  it('reassembles a JSON line split across two network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse(
      [{ response: 'الطقس', done: false }, { response: ' جميل', done: false }, { response: '', done: true }],
      { splitAt: 18 },
    )));

    const result = await streamGenerate(ENDPOINT, { model: 'x' });
    expect(result.text).toBe('الطقس جميل');
  });

  it('skips a malformed NDJSON line instead of throwing', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('{"response":"ok","done":false}\n'));
        c.enqueue(encoder.encode('{not json at all}\n'));
        c.enqueue(encoder.encode('{"response":"","done":true}\n'));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const result = await streamGenerate(ENDPOINT, { model: 'x' });
    expect(result.text).toBe('ok');
  });

  it('maps a 404 to model-missing and surfaces the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "model 'nope:1b' not found" }), { status: 404 }),
    ));
    await expect(streamGenerate(ENDPOINT, { model: 'nope:1b' }))
      .rejects.toMatchObject({ kind: 'model-missing', message: expect.stringContaining('not found') });
  });

  it('maps an aborted request to kind "aborted"', async () => {
    const err = new DOMException('The user aborted a request.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    await expect(streamGenerate(ENDPOINT, { model: 'x' })).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('preloadModel', () => {
  it('posts a prompt-less body and swallows failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(preloadModel(ENDPOINT, 'gemma3:12b')).resolves.toBeUndefined();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gemma3:12b');
    expect(body.prompt).toBeUndefined();
    expect(body.keep_alive).toBe('30m');
  });
});

it('exports an OllamaError carrying a kind', () => {
  expect(new OllamaError('boom', 'offline')).toBeInstanceOf(Error);
  expect(new OllamaError('boom', 'offline').kind).toBe('offline');
});

describe('listLoadedModels', () => {
  it('reports the GPU fraction for each resident model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      models: [
        { name: 'gemma3:12b', size: 8_900_000_000, size_vram: 100_000_000, context_length: 8192 },
        { name: 'allam:7b', size: 4_000_000_000, size_vram: 4_000_000_000, context_length: 4096 },
      ],
    })));

    const loaded = await listLoadedModels('http://localhost:11434');
    expect(loaded[0].name).toBe('gemma3:12b');
    expect(loaded[0].gpuFraction).toBeCloseTo(0.011, 3);
    expect(loaded[0].mostlyOnCpu).toBe(true);
    expect(loaded[1].gpuFraction).toBe(1);
    expect(loaded[1].mostlyOnCpu).toBe(false);
  });

  it('returns an empty list when nothing is resident', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ models: [] })));
    expect(await listLoadedModels('http://localhost:11434')).toEqual([]);
  });

  it('never throws -- it is a diagnostic, not a critical path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listLoadedModels('http://localhost:11434')).resolves.toEqual([]);
  });

  it('treats a model with unknown size as not CPU-offloaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      models: [{ name: 'x:1b', size: 0, size_vram: 0 }],
    })));
    const [m] = await listLoadedModels('http://localhost:11434');
    expect(m.mostlyOnCpu).toBe(false);
  });
});
