/**
 * CSS for the injected UI, adopted into a shadow root as a constructable
 * stylesheet. Keeping it in a shadow root is what stops aggressive host-page
 * resets (e.g. `* { all: unset !important }`) from destroying the widget.
 */
window.__ARTR.CSS = `
  :host { all: initial; }

  .bubble, .panel {
    position: fixed;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
  }

  .bubble {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #155e75;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, .28);
  }
  .bubble:hover { background: #0e7490; }
  .bubble[hidden] { display: none; }

  .panel {
    width: 380px;
    max-width: calc(100vw - 24px);
    max-height: 420px;
    display: flex;
    flex-direction: column;
    background: #fff;
    color: #111;
    border: 1px solid #d4d4d8;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, .22);
    overflow: hidden;
  }
  .panel[hidden] { display: none; }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: #f4f4f5;
    border-bottom: 1px solid #e4e4e7;
    font-size: 12px;
    color: #52525b;
  }

  .panel-actions { display: flex; gap: 4px; }

  .panel-actions button {
    border: 1px solid #d4d4d8;
    background: #fff;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    color: #27272a;
  }
  .panel-actions button:hover { background: #f4f4f5; }
  .panel-actions button[hidden] { display: none; }

  .panel-body {
    padding: 12px 14px;
    flex: 1 1 auto;
    min-height: 0;
    max-height: 320px;
    overflow-y: auto;
    font-size: 16px;
    line-height: 1.85;
    white-space: pre-wrap;
    word-wrap: break-word;
    direction: rtl;
    text-align: right;
  }

  .status {
    padding: 10px 14px;
    font-size: 13px;
    color: #52525b;
    direction: ltr;
    text-align: left;
  }
  .status[hidden] { display: none; }
  .status.error { color: #b91c1c; }
  .status .hint { display: block; margin-top: 4px; font-size: 12px; color: #71717a; }

  @keyframes artr-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
  .status.loading { animation: artr-pulse 1.3s ease-in-out infinite; }

  @media (prefers-color-scheme: dark) {
    .panel { background: #18181b; color: #f4f4f5; border-color: #3f3f46; }
    .panel-head { background: #27272a; border-color: #3f3f46; color: #a1a1aa; }
    .panel-actions button { background: #27272a; border-color: #52525b; color: #e4e4e7; }
    .panel-actions button:hover { background: #3f3f46; }
    .status { color: #a1a1aa; }
  }
`;
