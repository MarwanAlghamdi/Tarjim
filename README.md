# Ollama Arabic Translator

Select text anywhere in the browser and translate it to Modern Standard Arabic
using **your own local Ollama server**. Nothing is sent to a cloud service — the
extension only ever talks to the host you configure.

Works on ordinary web pages and, via a bundled PDF.js viewer, on PDFs.

---

## Setup

Run these in order. Step 1 is required — without it Ollama rejects the
extension with `403` before any model is reached.

### 1. Let Ollama accept the extension (needs sudo)

```bash
sudo tools/setup-ollama-cors.sh
```

Ollama validates the `Origin` header on every request and its default allowlist
covers only `localhost` / `127.0.0.1` / `0.0.0.0` plus a few app schemes.
`chrome-extension://` is not on it, so every call is refused:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:11434/api/tags \
    -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop'
403
```

The script writes `/etc/systemd/system/ollama.service.d/20-origins.conf`,
reloads systemd, restarts Ollama, and prints the verification result (expect
`200`). It uses a **separate** drop-in file, so the existing
`OLLAMA_HOST=0.0.0.0` setting is left untouched and the change is undone by
deleting that one file.

> **Security note.** The default value is `OLLAMA_ORIGINS=*`, which allows any
> origin. Because Ollama also binds `0.0.0.0`, that means any web page you visit
> can reach your local Ollama API. To restrict it to browser extensions instead:
>
> ```bash
> sudo OLLAMA_ORIGINS_VALUE='chrome-extension://*,moz-extension://*' tools/setup-ollama-cors.sh
> ```

### 2. Pull the default model

```bash
ollama pull gemma3:12b
```

### 3. Vendor the PDF.js viewer

Already committed to the repo. Re-run only to upgrade:

```bash
tools/vendor-pdfjs.sh
```

MV3 forbids remotely-hosted code, so the viewer ships inside the extension. The
script downloads the prebuilt release and applies two patches (see
`tools/patch-pdfjs.py`), both idempotent and verified after writing.

### 4. Load the extension

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this directory.

### 5. Optional: local PDF files

To translate PDFs opened from disk (`file://`), open the extension's
**Details** page and enable **Allow access to file URLs**. Chrome offers no
manifest key for this; it is a user-only toggle.

---

## Usage

| Trigger | How |
|---|---|
| Floating bubble | Select text → a **Translate** bubble appears → click it |
| Context menu | Right-click a selection → *Translate selection to Arabic* |
| Keyboard | Select text → `Alt+T` |
| Toolbar popup | Click the icon → paste text → **Translate** |
| PDFs | Open the PDF → toolbar icon → **Open this PDF in the translator viewer**, or right-click → *Open this PDF in the translator viewer* |

The result panel streams tokens as they arrive and renders right-to-left.
**Copy** puts the plain Arabic on the clipboard; **Stop** aborts mid-stream;
**Retry** re-runs the same selection; `Esc` closes.

### Options

`brave://extensions` → **Details** → **Extension options**.

- **Ollama server** — accepts `host:port` (e.g. `192.168.1.50:11434`) or a
  full URL. Any host other than localhost triggers a one-time permission
  prompt for that origin.
- **Model** — populated from `/api/tags`. Embedding models are hidden;
  reasoning models are labelled *not recommended* (see below).
- **Preload the model when text is selected** — on by default.

---

## Why PDFs need a separate viewer

Chrome's built-in PDF viewer renders through PDFium inside Chrome's own
internal extension. Extensions cannot inject content scripts into another
extension's pages, so `window.getSelection()` returns nothing there — Google's
own Translate extension has the same limitation. The bundled PDF.js viewer
renders a real, selectable text layer, so selection works normally.

## Why the model is preloaded

MV3 terminates a service worker when a `fetch()` response takes more than 30
seconds to arrive. A cold `gemma3:12b` was measured here at **24.5 s** to first
byte — a 5.5 s margin. So the extension fires a fire-and-forget preload the
moment the selection bubble appears, before you click. Ollama keeps loading the
model even if the worker is torn down, and if a request does die the panel
retries once automatically.

## Arabic vs. other Arabic-script languages

Text that is already Arabic is detected client-side and returned unchanged,
without ever reaching a model. Prompting for pass-through does not work — asked
to "return Arabic unchanged", ALLaM:7b *replied* to `السلام عليكم` with
`وعليكم السلام` instead of echoing it.

The detection is narrower than the Arabic Unicode block on purpose. Persian,
Urdu and Pashto use the same block plus extra letters (Persian
`پ چ ژ گ ی`, Urdu `ٹ ڈ ڑ ھ ہ ے`, …). Matching the whole block classifies them
as "already Arabic" and passes them through untranslated — precisely the case
this extension exists to handle. Only Modern Standard Arabic letters, harakat,
Arabic punctuation and ligatures count; numerals, whitespace and Western
punctuation are ignored, so `الفصل 3: المقدمة (2024)` still counts as Arabic.

## Why translations can suddenly take minutes

Ollama does not error when a model will not fit in free VRAM — it quietly
offloads the remainder to the CPU and runs 10–30x slower. Measured on this
machine while another process held 14.4 GB of a 16 GB card:

```
$ curl -s localhost:11434/api/ps
gemma3:12b   size 8.9 GB   size_vram 0.1 GB     <-- 1% on the GPU
```

A one-sentence translation went from ~2 s to ~33 s, and a browser round trip to
over two minutes. Nothing in Ollama's response indicates this.

The extension therefore checks `/api/ps` when the popup opens and shows an
orange banner naming the exact split when less than half the model is on the
GPU. `npm run verify:live` prints the same figure in its preflight, so a slow
live run explains itself instead of looking like a timeout.

To fix it: free the VRAM (`nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv`
shows what is holding it), or pick a model that fits in what is free.

## Why qwen3 models are flagged

On Ollama 0.32.3 the `think: false` parameter is ignored by `qwen3` on **both**
`/api/generate` and `/api/chat`. The model emits `<think>` reasoning that
consumes the entire output budget and returns no translation at all. The
extension strips `<think>` blocks defensively, but these models remain a poor
choice for translation.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Ollama refused the extension's origin (403)` | `OLLAMA_ORIGINS` not set | `sudo tools/setup-ollama-cors.sh` |
| `Cannot reach Ollama` | Not running, or wrong endpoint | `systemctl status ollama`; check the options page |
| No bubble on a PDF | Chrome's built-in viewer cannot expose selection | Use *Open this PDF in the translator viewer* |
| Empty translation, long delay | A `qwen3` model is selected | Switch to `gemma3:12b` in options |
| First translation slow, later ones fast | Cold model load (~24 s for `gemma3:12b`) | Keep *Preload the model* enabled |
| **Every** translation takes minutes | The model does not fit in free VRAM, so Ollama silently ran it on the CPU | The popup shows an orange warning with the exact GPU split. Run `nvidia-smi` to find what is holding VRAM, or choose a smaller model in options. See below. |
| No bubble on `brave://` pages or the Web Store | Chromium forbids content scripts on privileged pages | Expected; use the popup |
| Local PDF will not open in the viewer | File access is off | Enable **Allow access to file URLs** on the Details page |

---

## Development

```bash
npm install
npm test          # unit tests (Vitest)
npm run test:e2e  # end-to-end tests (Playwright)
npm run verify    # both

npm run verify:live   # against REAL Ollama (needs step 1 + the model pulled)
OLLAMA_ENDPOINT=192.168.1.50:11434 OLLAMA_MODEL=iKhalid/ALLaM:7b npm run verify:live
```

`verify:live` drives the real extension in a real browser against your actual
Ollama server: it preflights the CORS fix and the model, then translates
English and French selections and checks Arabic comes back, and confirms Arabic
input is passed through without a model call.

No build step: the service worker, options page and popup are native ES
modules; content scripts are classic scripts sharing a `window.__ARTR`
namespace, because MV3 content scripts cannot be ES modules.

E2E tests run against **Playwright's bundled Chromium**, not the installed
Brave. Snap-packaged browsers are confined by AppArmor and cannot write to an
arbitrary `--user-data-dir`, which sends the automation driver into a
`DevToolsActivePort` timeout loop; Playwright also injects Chromium flags that
conflict with Brave. Install it once with `npx playwright install chromium`.

Tests use a local NDJSON stub (`tests/stub/ollama-stub.js`) rather than real
Ollama, so they need no GPU, no model, and no CORS configuration, and can force
edge cases like a missing model or a malformed stream.

### Layout

```
manifest.json          MV3 manifest — the single source of permissions
src/shared/            ES modules: Ollama client, prompt, chunker, settings
src/background/        service worker: ports, preload, context menu, PDF open
src/content/           classic content scripts: selection + shadow-DOM UI
src/options/           options page
src/popup/             toolbar popup
src/pdfjs/             vendored PDF.js 6.2.108 (patched)
tools/                 setup-ollama-cors.sh, vendor-pdfjs.sh, patch-pdfjs.py
tests/                 unit (Vitest), e2e (Playwright), stub, fixtures
```
