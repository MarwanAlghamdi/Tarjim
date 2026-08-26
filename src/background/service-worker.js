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
let lastPreloadKey = '';

async function maybePreload(force = false) {
  const settings = await getSettings();
  if (!settings.autoPreload && !force) return;

  // Throttle per target, not per wall-clock alone: a different endpoint or
  // model is a different thing to warm, so it must never be suppressed by a
  // preload that was aimed somewhere else.
  const key = `${settings.endpoint}|${settings.model}`;
  const now = Date.now();
  if (!force && key === lastPreloadKey && now - lastPreloadAt < PRELOAD_INTERVAL_MS) return;

  lastPreloadAt = now;
  lastPreloadKey = key;

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

// Changing the endpoint or model must warm the NEW target immediately, so the
// throttle is cleared rather than making the user wait out the interval.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  maybePreload();
});

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
      controller = null;
      return;
    }

    if (msg?.type !== MSG.TRANSLATE) return;

    // A second request supersedes the first. Without this abort the earlier
    // stream keeps running and both write CHUNKs onto the same port, so the
    // panel interleaves two translations -- and the first request's `finally`
    // would clear the second's controller, leaving Stop with nothing to abort.
    controller?.abort();

    const mine = new AbortController();
    controller = mine;

    // Echo the caller's request id on every message so the content script can
    // discard replies belonging to a request it has already cancelled or
    // replaced. The id is the CLIENT's -- a counter of our own would drift out
    // of step with theirs after a cancel and every reply would look stale.
    const reqId = msg.reqId;
    const post = (message) => safePost(port, { ...message, reqId });

    try {
      const settings = await getSettings();

      const result = await translateText(msg.text, settings, {
        signal: mine.signal,
        onToken: (token) => post({ type: MSG.CHUNK, token }),
        onProgress: (p) => post({ type: MSG.PROGRESS, ...p }),
      });

      post({
        type: MSG.DONE,
        text: result.text,
        passthrough: result.passthrough,
        model: settings.model,
      });
    } catch (err) {
      if (err?.kind === 'aborted' || mine.signal.aborted) return;
      post({
        type: MSG.ERROR,
        kind: err?.kind ?? 'unknown',
        message: err?.message ?? 'Translation failed.',
      });
    } finally {
      // Only clear it if a newer run has not already taken ownership.
      if (controller === mine) controller = null;
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

  // frameId is essential: content scripts run in every frame (all_frames:
  // true), so a broadcast would open a panel and start a full generation in
  // each one. info.frameId is the frame the user actually right-clicked.
  chrome.tabs.sendMessage(
    tab.id,
    { type: MSG.TRANSLATE, text: info.selectionText ?? '' },
    { frameId: info.frameId ?? 0 },
  ).catch(() => { /* no content script in that frame */ });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // No frameId here: the shortcut carries no frame context. Broadcasting is
  // safe because a frame with no live selection ignores the message
  // (src/content/main.js), so only the focused frame acts.
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
const PDF_GATE_PATH = 'src/pdf/open.html';

/**
 * Send the tab to the permission gate page, which then redirects into the
 * bundled viewer.
 *
 * The worker deliberately does NOT call chrome.permissions.request() itself:
 * that API needs transient user activation, activation does not survive an
 * `await`, and this function must await tab lookups first. Requesting here
 * always rejects with "This function must be called during a user gesture",
 * which silently broke every http(s) PDF. src/pdf/open.js does the asking from
 * a real page click instead, and redirects straight through when the origin is
 * already granted.
 */
async function openPdfInViewer(tab) {
  if (!tab?.url) throw new Error('No file to open.');

  const gate = chrome.runtime.getURL(PDF_GATE_PATH) + '?src=' + encodeURIComponent(tab.url);
  await chrome.tabs.update(tab.id, { url: gate });
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
