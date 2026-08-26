import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildGenerateBody } from '../../src/shared/prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('names Modern Standard Arabic as the target', () => {
    expect(SYSTEM_PROMPT).toMatch(/Modern Standard Arabic/);
  });

  it('forbids preamble, transliteration and diacritics', () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY the Arabic translation/);
    expect(SYSTEM_PROMPT).toMatch(/romanize|transliterate/i);
    expect(SYSTEM_PROMPT).toMatch(/diacritic|tashkeel/i);
  });

  it('requires line-break and verbatim-span preservation', () => {
    expect(SYSTEM_PROMPT).toMatch(/line breaks/i);
    expect(SYSTEM_PROMPT).toMatch(/URLs/);
  });
});

describe('buildGenerateBody', () => {
  const base = { model: 'gemma3:12b', text: 'Hello world.' };

  it('targets /api/generate with a system prompt and streaming on', () => {
    const body = buildGenerateBody(base);
    expect(body.model).toBe('gemma3:12b');
    expect(body.prompt).toBe('Hello world.');
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.stream).toBe(true);
  });

  it('applies the documented defaults', () => {
    const body = buildGenerateBody(base);
    expect(body.keep_alive).toBe('30m');
    expect(body.options.temperature).toBe(0.2);
    expect(body.options.num_ctx).toBe(8192);
    expect(body.options.num_predict).toBe(2048);
    expect(body.options.top_p).toBe(0.9);
  });

  it('always sends think:false for thinking-capable models', () => {
    expect(buildGenerateBody(base).think).toBe(false);
  });

  it('allows overrides', () => {
    const body = buildGenerateBody({ ...base, keepAlive: '5m', numCtx: 4096, temperature: 0 });
    expect(body.keep_alive).toBe('5m');
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.temperature).toBe(0);
  });

  it('produces a preload body with no prompt when text is omitted', () => {
    const body = buildGenerateBody({ model: 'gemma3:12b' });
    expect(body.prompt).toBeUndefined();
    expect(body.stream).toBe(false);
  });
});
