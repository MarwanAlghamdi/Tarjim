import { DEFAULT_SETTINGS, STORAGE_KEY } from './defaults.js';

export { DEFAULT_SETTINGS };

const DEFAULT_PORT = 11434;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Accept what a person would actually type: "192.168.1.50:11434",
 * "localhost:11434", "http://localhost:11434/", or just "192.168.1.50".
 */
export function parseEndpoint(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Endpoint is required.' };

  const withScheme = SCHEME.test(raw) ? raw : `http://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'Not a valid address. Use host:port, e.g. 192.168.1.50:11434.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Endpoint must use http:// or https://.' };
  }
  if (!url.hostname) return { ok: false, error: 'Endpoint is missing a host.' };
  if (/\s/.test(url.hostname)) return { ok: false, error: 'Host must not contain spaces.' };

  // URL normalisation drops a port that is the scheme default (443 for https,
  // 80 for http), so recover it from the raw input rather than silently
  // rewriting "https://ollama.lan:443" to the Ollama default port.
  const authority = withScheme.replace(SCHEME, '');
  const explicit = /^[^/?#]*:(\d+)(?:[/?#]|$)/.exec(authority);
  const port = url.port || (explicit ? explicit[1] : String(DEFAULT_PORT));

  return { ok: true, url: `${url.protocol}//${url.hostname}:${port}` };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored?.[STORAGE_KEY] ?? {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };

  if (partial?.endpoint !== undefined) {
    const parsed = parseEndpoint(partial.endpoint);
    if (!parsed.ok) throw new Error(`Invalid endpoint: ${parsed.error}`);
    next.endpoint = parsed.url;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
