/**
 * Shadow-DOM UI: a floating bubble near the selection, and a result panel.
 *
 * Two non-obvious requirements:
 *  - mode MUST be 'open'. Playwright locators pierce open shadow roots but
 *    cannot see closed ones, so 'closed' would make the E2E suite impossible.
 *  - Every interactive element calls preventDefault() on mousedown. The browser
 *    begins a new text-selection gesture on mousedown, which would collapse the
 *    host page's selection before the click handler ever runs.
 */
(() => {
  const ns = window.__ARTR;

  const HOST_ID = 'ollama-ar-translator-root';
  const MARGIN = 8;
  const PANEL_WIDTH = 380;
  // The panel is measured for placement BEFORE any tokens exist, when it is
  // only ~60px tall. It grows to roughly this once streaming (.panel-body caps
  // at 320px plus header and status), so placing against the grown height is
  // what keeps it on screen instead of letting it run off the bottom.
  const PANEL_MAX_HEIGHT = 420;

  const handlers = { translate: [], cancel: [], retry: [], copy: [] };
  let shadow = null;
  let els = null;

  function mount() {
    if (shadow) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.all = 'initial';
    (document.body ?? document.documentElement).appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(ns.CSS);
    shadow.adoptedStyleSheets = [sheet];

    shadow.innerHTML = `
      <button class="bubble" part="bubble" hidden>
        <span aria-hidden="true">&#1593;</span><span>Translate</span>
      </button>
      <div class="panel" part="panel" hidden role="dialog" aria-label="Arabic translation">
        <div class="panel-head">
          <span class="panel-title">Arabic</span>
          <span class="panel-actions">
            <button class="btn-copy" hidden>Copy</button>
            <button class="btn-retry" hidden>Retry</button>
            <button class="btn-cancel" hidden>Stop</button>
            <button class="btn-close">Close</button>
          </span>
        </div>
        <div class="status" hidden></div>
        <div class="panel-body" dir="rtl" lang="ar"></div>
      </div>
    `;

    els = {
      host,
      bubble: shadow.querySelector('.bubble'),
      panel: shadow.querySelector('.panel'),
      title: shadow.querySelector('.panel-title'),
      status: shadow.querySelector('.status'),
      body: shadow.querySelector('.panel-body'),
      copy: shadow.querySelector('.btn-copy'),
      retry: shadow.querySelector('.btn-retry'),
      cancel: shadow.querySelector('.btn-cancel'),
      close: shadow.querySelector('.btn-close'),
    };

    // Guard the whole widget: stop the host page's own click-away and
    // selection-clearing logic from firing, and stop the browser from
    // collapsing the selection when the bubble is pressed.
    //
    // These MUST be bubble-phase, not capture. A capture listener on the host
    // runs before the event descends into the shadow tree, so stopPropagation
    // there would prevent the bubble/panel buttons from ever seeing their own
    // clicks. In the bubble phase the inner handler runs first, then the event
    // is stopped here before it can escape to the host page.
    host.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    host.addEventListener('click', (e) => e.stopPropagation());

    els.bubble.addEventListener('click', () => emit('translate'));
    els.copy.addEventListener('click', () => emit('copy'));
    els.retry.addEventListener('click', () => emit('retry'));
    els.cancel.addEventListener('click', () => emit('cancel'));
    els.close.addEventListener('click', () => closePanel());
  }

  function emit(name) {
    for (const fn of handlers[name]) fn();
  }

  /** Clamp a viewport-relative rect so the widget stays fully on screen. */
  function place(el, rect, width, height) {
    let left = rect.left;
    let top = rect.bottom + MARGIN;

    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (left < MARGIN) left = MARGIN;
    if (top + height > window.innerHeight - MARGIN) top = Math.max(MARGIN, rect.top - height - MARGIN);

    // position: fixed, so getBoundingClientRect values are used directly with
    // no scroll offset -- and the widget needs no reposition-on-scroll handler.
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function showBubble(rect) {
    mount();
    els.bubble.hidden = false;
    place(els.bubble, rect, els.bubble.offsetWidth || 110, els.bubble.offsetHeight || 30);
  }

  function hideBubble() {
    if (els) els.bubble.hidden = true;
  }

  function openPanel(rect) {
    mount();
    hideBubble();
    els.body.textContent = '';
    els.panel.hidden = false;
    place(els.panel, rect, PANEL_WIDTH, PANEL_MAX_HEIGHT);
  }

  function closePanel() {
    if (!els) return;
    els.panel.hidden = true;
    els.body.textContent = '';
    setState('idle');
  }

  function appendToken(token) {
    if (!els) return;
    els.body.textContent += token;
    els.body.scrollTop = els.body.scrollHeight;
  }

  /** states: 'idle' | 'loading' | 'streaming' | 'done' | 'passthrough' | 'error' */
  function setState(state, detail = {}) {
    if (!els) return;

    els.status.className = 'status';
    els.status.hidden = true;
    els.status.textContent = '';
    els.cancel.hidden = true;
    els.retry.hidden = true;
    els.copy.hidden = true;

    if (state === 'loading') {
      els.status.hidden = false;
      els.status.classList.add('loading');
      els.status.textContent = detail.message ?? 'Translating...';
      els.cancel.hidden = false;
    } else if (state === 'streaming') {
      els.status.hidden = false;
      els.status.classList.add('loading');
      els.status.textContent = detail.total > 1
        ? `Translating... part ${detail.chunk} of ${detail.total}`
        : 'Translating...';
      els.cancel.hidden = false;
    } else if (state === 'done') {
      els.copy.hidden = false;
      els.retry.hidden = false;
      els.title.textContent = detail.model ? `Arabic · ${detail.model}` : 'Arabic';
    } else if (state === 'passthrough') {
      els.status.hidden = false;
      els.status.textContent = 'This text is already Arabic - shown unchanged.';
      els.copy.hidden = false;
    } else if (state === 'error') {
      els.status.hidden = false;
      els.status.classList.add('error');
      els.status.textContent = detail.message ?? 'Translation failed.';
      if (detail.hint) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = detail.hint;
        els.status.appendChild(hint);
      }
      els.retry.hidden = false;
    }
  }

  ns.ui = {
    mount,
    showBubble,
    hideBubble,
    openPanel,
    closePanel,
    appendToken,
    setState,
    getText: () => (els ? els.body.textContent : ''),
    isPanelOpen: () => Boolean(els && !els.panel.hidden),
    containsNode: (node) => Boolean(els && els.host.contains(node)),
    onTranslateClick: (fn) => handlers.translate.push(fn),
    onCancelClick: (fn) => handlers.cancel.push(fn),
    onRetryClick: (fn) => handlers.retry.push(fn),
    onCopyClick: (fn) => handlers.copy.push(fn),
  };
})();
