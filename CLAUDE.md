# Tarjim ترجِم

MV3 browser extension. Select text → Modern Standard Arabic, from a local model
server. Zero runtime dependencies, no build step.

## Commands

```bash
npm run verify        # unit (Vitest) + 25 e2e (Playwright). Run before every commit.
npm test              # unit only, ~1s
npm run test:e2e      # e2e only, against the local stub
npm run package       # dist/ zip + crx; runs the e2e suite against the staged tree
npm run verify:live   # against REAL Ollama — needs the CORS script + a model pulled
npm run verify:brave  # drives the actual installed Brave, not Playwright's Chromium

node tools/check-readme.mjs all   # docs lint: links, commands, shape, privacy
node tools/screenshots.mjs        # regenerate docs/images/ against real Ollama
```

## Architecture

```
src/shared/       ES modules. backend.js dispatches to ollama.js | openai.js
src/background/   service worker: port protocol, preload, context menu
src/content/      CLASSIC scripts (not modules), shared via window.__ARTR
src/options/      options page      src/popup/  toolbar popup
src/pdf/          permission gate     src/pdfjs/  vendored PDF.js — do not hand-edit
```

Request flow: content script → `chrome.runtime.connect` port → service worker →
`translateText()` → `clientFor(settings).streamGenerate()`.

## Gotchas

Each of these was a real defect. Do not undo them.

- **Never call `ollama.js` or `openai.js` directly.** Go through
  `clientFor(settings)` in `src/shared/backend.js`. The two servers share no
  paths and no body shape; hardcoding one 404s the other.
- **Content scripts cannot be ES modules.** `src/content/*.js` are classic
  scripts sharing `window.__ARTR`. Protocol constants are duplicated in
  `src/content/ns.js` and `src/shared/protocol.js`; `tests/unit/protocol.test.js`
  fails if they drift.
- **`chrome.permissions.request()` needs transient user activation, which does
  not survive an `await`.** The service worker can never call it — that is why
  `src/pdf/open.html` exists.
- **Shadow root must stay `mode: 'open'`.** Playwright locators cannot pierce a
  closed one, which would make the whole e2e suite impossible.
- **MV3 kills a `fetch` at 30s.** A cold 12B model is ~24.5s to first byte, so
  the extension preloads speculatively when the bubble appears.
- **Do not add a dependency.** `dependencies` is `{}` on purpose; devDependencies
  are Vitest, Playwright, jsdom and Chrome types only.

## Testing

E2E runs against **Playwright's bundled Chromium**, never the installed Brave —
snap AppArmor blocks an arbitrary `--user-data-dir` and the driver hangs on
`DevToolsActivePort`. `verify:brave` is the deliberate exception.

Tests drive a local NDJSON/SSE stub (`tests/stub/`), so they need no GPU and no
model. `EXTENSION_DIR=dist/unpacked npx playwright test` runs the same suite
against a packaged build.

New behaviour needs a test that fails without the fix. Prove it: stash the source
change, run the test, confirm red.

## Before committing

1. `npm run verify` — green
2. Touched UI text? Re-run `node tools/screenshots.mjs`; a stale screenshot is a
   silent doc bug and the docs lint cannot read images
3. Touched docs? `node tools/check-readme.mjs all`
4. Conventional Commits. The body explains *why*, with the measurement or failure
   that motivated it — match the existing log

## This repo is public

No LAN addresses, home directories, real emails, or extension IDs in code, docs,
comments, tests, or commit messages. `192.168.1.50` is the sanctioned example.
`node tools/check-readme.mjs privacy` enforces this for docs and shipped strings.

Git identity is set repo-local to a GitHub noreply address; do not override it.
`.crx-key.pem` is gitignored and must never be committed — the extension ID is a
hash of it, so losing or leaking it breaks upgrades for every user.

## Deeper reasoning

`docs/WHY.md` records every measured decision: the Ollama 403, the CPU-offload
detection, the Persian/Urdu edge case, the `<think>` leak, CRX signing.
