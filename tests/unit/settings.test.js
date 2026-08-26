import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseEndpoint, getSettings, saveSettings } from '../../src/shared/settings.js';

describe('parseEndpoint', () => {
  it('accepts a bare host:port and adds the scheme', () => {
    expect(parseEndpoint('192.168.1.50:11434')).toEqual({ ok: true, url: 'http://192.168.1.50:11434' });
    expect(parseEndpoint('localhost:11434')).toEqual({ ok: true, url: 'http://localhost:11434' });
  });

  it('accepts a full URL and strips the trailing slash', () => {
    expect(parseEndpoint('http://localhost:11434/')).toEqual({ ok: true, url: 'http://localhost:11434' });
    expect(parseEndpoint('https://ollama.lan:443')).toEqual({ ok: true, url: 'https://ollama.lan:443' });
  });

  it('defaults to port 11434 when only a host is given', () => {
    expect(parseEndpoint('192.168.1.50')).toEqual({ ok: true, url: 'http://192.168.1.50:11434' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseEndpoint('  localhost:11434  ')).toEqual({ ok: true, url: 'http://localhost:11434' });
  });

  it('rejects empty and malformed input', () => {
    expect(parseEndpoint('').ok).toBe(false);
    expect(parseEndpoint('   ').ok).toBe(false);
    expect(parseEndpoint('http://').ok).toBe(false);
    expect(parseEndpoint('not a host').ok).toBe(false);
  });

  it('rejects a host that a browser would percent-encode', () => {
    // Chromium accepts `new URL("http://not a host")` and encodes the spaces,
    // where Node throws. Both must be rejected, so the encoded form is tested
    // explicitly rather than relying on the constructor to throw.
    expect(parseEndpoint('http://not%20a%20host:11434').ok).toBe(false);
    expect(parseEndpoint('http://bad_host%2Fpath:11434').ok).toBe(false);
  });

  it('accepts hostnames, IPv4 and bracketed IPv6 literals', () => {
    expect(parseEndpoint('ollama.lan:11434').ok).toBe(true);
    expect(parseEndpoint('192.168.1.50:11434').ok).toBe(true);
    expect(parseEndpoint('[::1]:11434')).toEqual({ ok: true, url: 'http://[::1]:11434' });
  });

  it('rejects a non-http scheme', () => {
    expect(parseEndpoint('ftp://localhost:11434').ok).toBe(false);
  });
});

describe('settings store', () => {
  it('returns defaults when storage is empty', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults the model to gemma3:12b', () => {
    expect(DEFAULT_SETTINGS.model).toBe('gemma3:12b');
    expect(DEFAULT_SETTINGS.endpoint).toBe('http://localhost:11434');
  });

  it('merges a partial save over the defaults', async () => {
    const saved = await saveSettings({ model: 'iKhalid/ALLaM:7b' });
    expect(saved.model).toBe('iKhalid/ALLaM:7b');
    expect(saved.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
    expect((await getSettings()).model).toBe('iKhalid/ALLaM:7b');
  });

  it('normalizes an ip:port endpoint on save', async () => {
    const saved = await saveSettings({ endpoint: '192.168.1.50:11434' });
    expect(saved.endpoint).toBe('http://192.168.1.50:11434');
  });

  it('rejects an invalid endpoint on save', async () => {
    await expect(saveSettings({ endpoint: 'nonsense value' })).rejects.toThrow(/endpoint/i);
  });
});
