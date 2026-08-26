/**
 * Shared namespace for the content scripts.
 *
 * MV3 content scripts cannot be ES modules, so the files listed in
 * manifest.json's content_scripts[].js run as classic scripts in one isolated
 * world and communicate through this object.
 *
 * The constants below duplicate src/shared/protocol.js by necessity.
 * tests/unit/protocol.test.js fails if the two ever drift.
 */
window.__ARTR = window.__ARTR || {};

window.__ARTR.PORT_NAME = 'ollama-ar-translate';

window.__ARTR.MSG = {
  TRANSLATE: 'translate',
  PRELOAD: 'preload',
  CANCEL: 'cancel',
  CHUNK: 'chunk',
  PROGRESS: 'progress',
  DONE: 'done',
  ERROR: 'error',
  STATUS: 'status',
};
