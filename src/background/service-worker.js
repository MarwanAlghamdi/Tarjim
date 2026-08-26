import { PORT_NAME, MSG } from '../shared/protocol.js';
import { getSettings } from '../shared/settings.js';
import { preloadModel } from '../shared/ollama.js';
import { translateText } from '../shared/translate.js';

const CONTEXT_MENU_ID = 'ollama-ar-translate-selection';

/* ------------------------------------------------------------------ *
 * Cold-start mitigation
 *
 * MV3 terminates a service worker when a fetch response takes more than
 * 30 seconds to arrive. gemma3:12b was measured at 24.5s time-to-first-byte
 * cold -- a 5.5s margin. Preloading collapses that to well under a second.
 *
 * The preload is deliberately fire-and-forget: Ollama keeps loading the model
 * server-side even if this worker is torn down mid-request, so the load
 * completes regardless. It is throttled so that a user dragging across a page
 * does not issue a request per selection.
 * ------------------------------------------------------------------ */
const PRELOAD_INTERVAL_MS = 60_000;
let lastPreloadAt = 0;

async function maybePreload(force = false) {
  const settings = await getSettings();
  if (!settings.autoPreload && !force) return;

  const now = Date.now();
  if (!force && now - lastPreloadAt < PRELOAD_INTERVAL_MS) return;
  lastPreloadAt = now;

  preloadModel(settings.endpoint, settings.model);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Translate selection to Arabic',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'ollama-ar-open-pdf',
      title: 'Open this PDF in the translator viewer',
      contexts: ['page'],
      documentUrlPatterns: ['*://*/*.pdf', 'file://*/*.pdf'],
    });
  });
  maybePreload(true);
});

chrome.runtime.onStartup.addListener(() => maybePreload(true));

/* ------------------------------------------------------------------ *
 * Port protocol
 *
 * A long-lived port is used rather than sendMessage for two reasons: tokens
 * stream back incrementally, and port traffic resets the worker's 30s idle
 * timer for the duration of the translation.
 * ------------------------------------------------------------------ */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  let controller = null;

  port.onDisconnect.addListener(() => controller?.abort());

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === MSG.PRELOAD) {
      maybePreload();
      return;
    }

    if (msg?.type === MSG.CANCEL) {
      controller?.abort();
      return;
    }

    if (msg?.type !== MSG.TRANSLATE) return;

    controller = new AbortController();

    try {
      const settings = await getSettings();

      const result = await translateText(msg.text, settings, {
        signal: controller.signal,
        onToken: (token) => safePost(port, { type: MSG.CHUNK, token }),
        onProgress: (p) => safePost(port, { type: MSG.PROGRESS, ...p }),
      });

      safePost(port, {
        type: MSG.DONE,
        text: result.text,
        passthrough: result.passthrough,
        model: settings.model,
      });
    } catch (err) {
      if (err?.kind === 'aborted') return;
      safePost(port, {
        type: MSG.ERROR,
        kind: err?.kind ?? 'unknown',
        message: err?.message ?? 'Translation failed.',
      });
    } finally {
      controller = null;
    }
  });
});

/** postMessage after the other end has gone throws; that is not an error here. */
function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    /* port already closed */
  }
}

/* ------------------------------------------------------------------ *
 * Alternative triggers: context menu and Alt+T
 * ------------------------------------------------------------------ */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ollama-ar-open-pdf') {
    openPdfInViewer(tab).catch((err) => console.warn('[ollama-ar]', err.message));
    return;
  }

  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: MSG.TRANSLATE, text: info.selectionText ?? '' })
    .catch(() => { /* no content script on this page */ });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: MSG.TRANSLATE })
    .catch(() => { /* no content script on this page */ });
});

/* ------------------------------------------------------------------ *
 * PDF support
 *
 * Chrome's built-in PDF viewer runs inside Chrome's own internal extension
 * (mhjfbmdgcfjbbpaeojofohoefgiehjai) rendering via PDFium. Extensions cannot
 * inject content scripts into another extension's pages, so getSelection()
 * from our content script returns nothing there -- Google's own Translate
 * extension documents the identical limitation. The fix is to reopen the file
 * in a bundled PDF.js viewer, whose text layer is ordinary selectable DOM.
 * ------------------------------------------------------------------ */
const VIEWER_PATH = 'src/pdfjs/web/viewer.html';

async function openPdfInViewer(tab) {
  if (!tab?.url) throw new Error('No file to open.');

  if (tab.url.startsWith('file://')) {
    if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
      throw new Error(
        'Enable "Allow access to file URLs" for this extension at brave://extensions, then try again.',
      );
    }
  } else {
    const origin = `${new URL(tab.url).origin}/*`;
    if (!(await chrome.permissions.contains({ origins: [origin] }))
        && !(await chrome.permissions.request({ origins: [origin] }))) {
      throw new Error('Permission to read that site was denied.');
    }
  }

  const viewer = chrome.runtime.getURL(VIEWER_PATH) + '?file=' + encodeURIComponent(tab.url);
  await chrome.tabs.update(tab.id, { url: viewer });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'open-pdf') return;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await openPdfInViewer(tab);
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the channel open for the async sendResponse
});
