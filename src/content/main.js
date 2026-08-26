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

  /* ---------------- port ---------------- */

  function connect() {
    port = chrome.runtime.connect({ name: PORT_NAME });

    port.onMessage.addListener((msg) => {
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
    if (kind === 'cors') return 'Run tools/setup-ollama-cors.sh, then reload this page.';
    if (kind === 'offline') return 'Is Ollama running? Check the endpoint in the extension options.';
    if (kind === 'model-missing') return 'Pull the model with: ollama pull gemma3:12b';
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      ui.hideBubble();
      ui.closePanel();
      send({ type: MSG.CANCEL });
    }
  });

  window.addEventListener('scroll', () => ui.hideBubble(), { passive: true, capture: true });

  /* ---------------- run ---------------- */

  function run(text, resetRetry = true) {
    if (!text) return;
    if (resetRetry) retriedOnce = false;

    receivedAnyToken = false;
    ui.openPanel(lastRect ?? { left: 20, top: 20, bottom: 20 });
    ui.setState('loading');
    send({ type: MSG.TRANSLATE, text });
  }

  ui.onTranslateClick(() => run(lastText));
  ui.onRetryClick(() => run(lastText));
  ui.onCancelClick(() => {
    send({ type: MSG.CANCEL });
    ui.setState('error', { message: 'Cancelled.' });
  });
  ui.onCopyClick(() => navigator.clipboard.writeText(ui.getText()).catch(() => {}));

  /* ---------------- context menu / Alt+T ---------------- */

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== MSG.TRANSLATE) return;

    const selection = currentSelection();
    const text = msg.text || selection?.text || lastText;
    if (selection) lastRect = selection.rect;
    if (text) {
      lastText = text;
      run(text);
    }
  });

  ui.mount();
})();
