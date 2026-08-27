export const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  endpoint: 'http://localhost:11434',
  // Which API dialect the endpoint speaks; see src/shared/backend.js.
  // Detected on "Test connection"/Save, so it is never hand-edited.
  backend: 'ollama',
  // Chosen for Arabic output quality. Its measured cold time-to-first-byte is
  // 24.5s against MV3's 30s fetch limit, which is why autoPreload defaults on.
  model: 'gemma3:12b',
  keepAlive: '30m',
  maxChunkChars: 1800,
  numCtx: 8192,
  autoPreload: true,
});
