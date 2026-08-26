/**
 * Wire protocol between content scripts and the service worker.
 *
 * These literals are duplicated in src/content/ns.js because MV3 content
 * scripts cannot import ES modules. tests/unit/protocol.test.js asserts the
 * two copies stay in sync.
 */
export const PORT_NAME = 'ollama-ar-translate';

export const MSG = Object.freeze({
  TRANSLATE: 'translate',
  PRELOAD: 'preload',
  CANCEL: 'cancel',
  CHUNK: 'chunk',
  PROGRESS: 'progress',
  DONE: 'done',
  ERROR: 'error',
  STATUS: 'status',
});
