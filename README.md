# Tarjim ترجِم

Select text in your browser, get Modern Standard Arabic. The model runs on a
server you control — nothing is sent to a third party.

![An English paragraph selected on a web page, with the Arabic translation streaming into a floating panel](docs/images/page.png)

## Install

1. Download the extension folder, or clone this repository
2. Open your browser's extensions page and turn on **Developer mode**
3. Choose **Load unpacked** and select the folder
4. Open the extension's options and enter your model server's address
5. Select text on any page and click **Translate**

That is the whole setup. Nothing to configure on the server, nothing to install
first, no administrator rights.

## Requirements

- A Chromium-based browser, version 126 or newer
- A model server you can reach over HTTP, with at least one text model loaded

## Servers it works with

| Server | API it uses |
|---|---|
| Ollama | native (`/api/tags`, `/api/generate`) |
| llama.cpp, LM Studio, vLLM, and other OpenAI-compatible servers | `/v1/models`, `/v1/chat/completions` |

**Test connection** detects which of the two an address speaks, so you enter an
address and nothing else. The model list is read from the server — whatever you
already have installed is what you can pick.

## Using it

| Trigger | What you do |
|---|---|
| Bubble | Select text → click **Translate** |
| Right-click | Select text → *Translate selection to Arabic* |
| Toolbar | Click the icon → paste text → **Translate** |
| PDF | Toolbar icon → **Open this PDF in the translator viewer** |

![A Translate bubble appearing directly under the selected text](docs/images/bubble.png)

Click it and the panel streams tokens as the model produces them.

![The result panel showing Arabic text right-to-left, with Copy, Retry and Close buttons](docs/images/panel.png)

`Esc` closes the panel. **Copy** puts plain Arabic on the clipboard, **Stop**
aborts mid-stream, **Retry** re-runs the same selection.

## Translating typed text

Click the toolbar icon. The dot turns green once the server answers.

![The toolbar popup translating a short English sentence into Arabic](docs/images/popup.png)

## Settings

![The options page connected to a server, with a model selected](docs/images/options.png)

- **Model server** — `host:port` or a full URL. A non-local address prompts once
  for permission to reach it
- **Model** — read live from the server; embedding models are hidden
- **Preload** — keeps the model in memory so the first translation is not
  delayed by a cold load

A server on another machine has to be listening on an address your browser can
reach, not only on loopback.

## PDFs

A browser's built-in PDF viewer cannot hand a text selection to an extension,
so Tarjim ships its own viewer where selection works normally.

![The bundled PDF viewer with a paper title selected and the Translate bubble showing](docs/images/pdf.png)

For files opened from disk, enable **Allow access to file URLs** on the
extension's details page.

## Troubleshooting

| What you see | What it means |
|---|---|
| `Cannot reach the server` | Wrong address, or the server is not running |
| `Nothing answered at that address` | Right host, wrong port, or it is bound only to loopback |
| `No usable model on that server` | The server has no text model, only embeddings |
| Every translation takes minutes | The model does not fit in GPU memory; the popup shows the split |
| No bubble on the browser's own pages | Extensions cannot run there; use the toolbar popup |

## Building a release

```bash
npm install
npm run package
```

Writes `dist/tarjim-<version>.zip` for **Load unpacked**, plus a signed `.crx`.
The end-to-end suite runs against the packaged tree, so what ships is what was
tested. Keep `.crx-key.pem` — the extension's identity is derived from it, and
signing with a different key looks to the browser like a different extension.

## Development

```bash
npm test          # unit tests
npm run verify    # unit + end-to-end tests in a real browser
npm run verify:live   # against a real server instead of the test stub
```

Tests drive a local stub, so they need no GPU and no model. There is no build
step: the service worker, options page and popup are ES modules, and the
content scripts are classic scripts sharing one namespace.

See [CLAUDE.md](CLAUDE.md) for the architecture and the constraints behind it.
