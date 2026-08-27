export const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  endpoint: 'http://localhost:11434',
  // Which API dialect the endpoint speaks; see src/shared/backend.js.
  // Detected on "Test connection"/Save, so it is never hand-edited.
  backend: 'ollama',
  // Empty on purpose: the extension ships no required model and picks whatever
  // the configured server already has. See src/shared/models.js.
  model: '',
  keepAlive: '30m',
  maxChunkChars: 1800,
  numCtx: 8192,
  autoPreload: true,
});
