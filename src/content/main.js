/**
 * Selection detection and service-worker plumbing.
 *
 * The selected text is captured on mouseup and cached, so that a later click
 * collapsing the selection cannot lose it. The preload ping fired when the
 * bubble appears is the mechanism that hides gemma3:12b's 24.5s cold load:
 * the model starts loading while the user is still deciding whether to click.
 */
(() => {
  const { MSG, PORT_NAME, ui } = window.__ARTR;

  const MIN_LENGTH = 1;
  const MAX_LENGTH = 20000;

  let lastText = '';
  let lastRect = null;
  let port = null;
  let receivedAnyToken = false;
  let retriedOnce = false;
  // Identifies the translation the panel is currently showing.
  //
  // The id is generated HERE and echoed back by the service worker, rather than
  // being minted by the worker. An earlier version had both sides keeping their
  // own counters; after a cancel the client's counter ran ahead of the worker's
  // and every subsequent reply was discarded as "stale", leaving the panel
  // stuck on "Translating..." forever.
  let currentReqId = 0;

  /* ---------------- port ---------------- */

  function connect() {
    port = chrome.runtime.connect({ name: PORT_NAME });

    port.onMessage.addListener((msg) => {
      // Ignore anything that belongs to a superseded or cancelled request.
      if (typeof msg.reqId === 'number' && msg.reqId !== currentReqId) return;

      if (msg.type === MSG.CHUNK) {
        receivedAnyToken = true;
        ui.appendToken(msg.token);
      } else if (msg.type === MSG.PROGRESS) {
        ui.setState('streaming', { chunk: msg.chunk, total: msg.total });
      } else if (msg.type === MSG.DONE) {
        ui.setState(msg.passthrough ? 'passthrough' : 'done', { model: msg.model });
      } else if (msg.type === MSG.ERROR) {
        ui.setState('error', { message: msg.message, hint: hintFor(msg.kind) });
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;

      // The service worker was torn down mid-request. The overwhelmingly likely
      // cause is MV3's 30s fetch cap firing during a cold model load -- and by
      // now Ollama has finished loading server-side, so one silent retry
      // usually succeeds immediately.
      if (ui.isPanelOpen() && !receivedAnyToken && !retriedOnce) {
        retriedOnce = true;
        ui.setState('loading', { message: 'Model was still loading - retrying...' });
        setTimeout(() => run(lastText, false), 300);
      }
    });

    return port;
  }

  function send(message) {
    try {
      (port ?? connect()).postMessage(message);
    } catch {
      connect().postMessage(message);
    }
  }

  function hintFor(kind) {
    if (kind === 'cors') return 'Reload the extension, then reload this page.';
    if (kind === 'offline') return 'Is the server running? Check the address in the extension options.';
    if (kind === 'model-missing') return 'Pick a different model in the extension options.';
    return '';
  }

  /* ---------------- selection ---------------- */

  function currentSelection() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const text = sel.toString().trim();
    if (text.length < MIN_LENGTH) return null;

    return { text: text.slice(0, MAX_LENGTH), rect: sel.getRangeAt(0).getBoundingClientRect() };
  }

  document.addEventListener('mouseup', (event) => {
    if (ui.containsNode(event.target)) return; // click inside our own widget

    // Let the browser finish updating the selection before reading it.
    setTimeout(() => {
      const selection = currentSelection();
      if (!selection) {
        ui.hideBubble();
        return;
      }

      lastText = selection.text;
      lastRect = selection.rect;
      ui.showBubble(selection.rect);

      // Speculative: start loading the model now, not on click.
      send({ type: MSG.PRELOAD });
    }, 0);
  }, true);

  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) ui.hideBubble();
  });

  function stopAndClose() {
    ui.hideBubble();
    ui.closePanel();
    cancelActiveRun();
  }

  /** Abort whatever is streaming and stop accepting its messages. */
  function cancelActiveRun() {
    send({ type: MSG.CANCEL });
    // Moving to a fresh id means replies to the cancelled request no longer
    // match and are dropped, even if they were already in flight.
    currentReqId += 1;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopAndClose();
  });

  /**
   * Follow the selection on scroll rather than dismissing.
   *
   * capture:true on window means this fires for EVERY scrollable element on the
   * page, not just the document -- scroll does not bubble, but it does reach
   * window in the capture phase. Hiding on any of them meant a sticky header
   * script, a lazy-loaded image shifting layout, smooth-scroll momentum, or the
   * auto-scroll of the very drag that made the selection all dismissed the
   * bubble before the user could click it. Measured: a 5px window scroll with
   * the selection still fully on screen was enough.
   *
   * The bubble is position:fixed, so it has to be re-placed against the live
   * selection rect; it is only hidden once that selection is gone or has
   * scrolled out of the viewport.
   */
  window.addEventListener('scroll', () => {
    const selection = currentSelection();
    if (!selection) {
      ui.hideBubble();
      return;
    }

    const { rect } = selection;
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      ui.hideBubble();
      return;
    }

    lastRect = rect;
    ui.repositionBubble(rect);
  }, { passive: true, capture: true });

  /* ---------------- run ---------------- */

  function run(text, resetRetry = true) {
    if (!text) return;
    if (resetRetry) retriedOnce = false;

    // Supersede anything already streaming. The worker aborts its side too;
    // this guards the window before that takes effect.
    const reqId = ++currentReqId;

    receivedAnyToken = false;
    ui.openPanel(lastRect ?? { left: 20, top: 20, bottom: 20 });
    ui.setState('loading');
    send({ type: MSG.TRANSLATE, text, reqId });
  }

  ui.onTranslateClick(() => run(lastText));
  ui.onRetryClick(() => run(lastText));
  ui.onCancelClick(() => {
    cancelActiveRun();
    ui.setState('error', { message: 'Cancelled.' });
  });
  ui.onCopyClick(() => navigator.clipboard.writeText(ui.getText()).catch(() => {}));

  /* ---------------- context menu / Alt+T ---------------- */

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== MSG.TRANSLATE) return;

    const selection = currentSelection();

    // The Alt+T shortcut has no frame context, so the worker broadcasts it to
    // every frame. Only the frame that actually holds the selection may act --
    // otherwise a page with iframes opens one panel and starts one full
    // generation per frame. (The context-menu path is frame-targeted by the
    // worker, and always supplies msg.text.)
    if (!selection && !msg.text) return;

    const text = msg.text || selection?.text || '';
    if (selection) lastRect = selection.rect;
    if (!text) return;

    lastText = text;
    run(text);
  });

  ui.mount();
})();
