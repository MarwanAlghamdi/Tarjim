import { describe, it, expect, vi } from 'vitest';
import { translateText } from '../../src/shared/translate.js';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults.js';
import { ndjsonResponse } from '../helpers/ndjson.js';
import { sseResponse, delta } from '../helpers/sse.js';

const settings = { ...DEFAULT_SETTINGS, maxChunkChars: 50 };

function fakeStream(perCallText) {
  let call = 0;
  return vi.fn(async (_endpoint, _body, { onToken } = {}) => {
    const text = perCallText[call++] ?? '';
    onToken?.(text);
    return { text, doneReason: 'stop' };
  });
}

describe('translateText', () => {
  it('short-circuits Arabic-only input without calling the model', async () => {
    const streamGenerate = vi.fn();
    const result = await translateText('السلام عليكم ورحمة الله', settings, { deps: { streamGenerate } });

    expect(streamGenerate).not.toHaveBeenCalled();
    expect(result.passthrough).toBe(true);
    expect(result.text).toBe('السلام عليكم ورحمة الله');
  });

  it('translates a single short selection in one call', async () => {
    const streamGenerate = fakeStream([' الطقس جميل ']);
    const result = await translateText('The weather is nice.', settings, { deps: { streamGenerate } });

    expect(streamGenerate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('الطقس جميل');
    expect(result.passthrough).toBe(false);
  });

  it('splits long text and rejoins chunks with a blank line', async () => {
    const streamGenerate = fakeStream(['الأول', 'الثاني']);
    const long = `${'A'.repeat(45)}\n\n${'B'.repeat(45)}`;
    const result = await translateText(long, settings, { deps: { streamGenerate } });

    expect(streamGenerate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('الأول\n\nالثاني');
    expect(result.chunks).toBe(2);
  });

  it('reports progress per chunk', async () => {
    const onProgress = vi.fn();
    const streamGenerate = fakeStream(['أ', 'ب']);
    const long = `${'A'.repeat(45)}\n\n${'B'.repeat(45)}`;
    await translateText(long, settings, { onProgress, deps: { streamGenerate } });

    expect(onProgress).toHaveBeenCalledWith({ chunk: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith({ chunk: 2, total: 2 });
  });

  it('forwards tokens as they stream', async () => {
    const tokens = [];
    const streamGenerate = fakeStream(['الطقس جميل']);
    await translateText('Nice weather.', settings, {
      onToken: (t) => tokens.push(t),
      deps: { streamGenerate },
    });
    expect(tokens).toEqual(['الطقس جميل']);
  });

  it('strips leaked think blocks from the assembled output', async () => {
    const streamGenerate = fakeStream(['<think>hmm</think>الطقس جميل']);
    const result = await translateText('Nice weather.', settings, { deps: { streamGenerate } });
    expect(result.text).toBe('الطقس جميل');
  });

  it('rejects empty input', async () => {
    await expect(translateText('   ', settings, { deps: { streamGenerate: vi.fn() } }))
      .rejects.toThrow(/nothing to translate/i);
  });

  it('passes endpoint, model and numCtx through to the client', async () => {
    const streamGenerate = fakeStream(['x']);
    await translateText('Hello.', settings, { deps: { streamGenerate } });

    const [endpoint, body] = streamGenerate.mock.calls[0];
    expect(endpoint).toBe(settings.endpoint);
    expect(body.model).toBe('gemma3:12b');
    expect(body.options.num_ctx).toBe(8192);
    expect(body.keep_alive).toBe('30m');
  });
});

describe('backend routing', () => {
  it('sends an Ollama translation to /api/generate as NDJSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse([
      { response: 'الطقس جميل', done: false },
      { response: '', done: true, done_reason: 'stop' },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await translateText('The weather is nice.', { ...settings, backend: 'ollama' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).toBe('The weather is nice.');
    expect(result.text).toBe('الطقس جميل');
  });

  // The bug this routing exists for: a llama-server has no /api/generate, so
  // before the split every translation against one 404'd.
  it('sends an OpenAI-compatible translation to /v1/chat/completions as SSE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      delta('الطقس جميل'),
      delta(null, 'stop'),
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await translateText('The weather is nice.', {
      ...settings,
      backend: 'openai',
      endpoint: 'http://192.168.1.50:8081',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.50:8081/v1/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'The weather is nice.' });
    expect(result.text).toBe('الطقس جميل');
  });
});
