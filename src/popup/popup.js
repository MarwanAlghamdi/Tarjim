import { getSettings } from '../shared/settings.js';
import { clientFor } from '../shared/backend.js';
import { applyOriginRule } from '../shared/origin-rule.js';
import { pickModel } from '../shared/models.js';
import { tabIsPdf } from '../shared/pdf.js';
import { translateText } from '../shared/translate.js';

const $ = (id) => document.getElementById(id);
const el = {
  conn: $('conn'), connText: $('conn-text'), options: $('options'),
  input: $('input'), go: $('go'), output: $('output'), status: $('status'),
  pdfBtn: $('open-pdf'), pdfHint: $('pdf-hint'), perfWarning: $('perf-warning'),
};

let settings = null;

el.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

el.go.addEventListener('click', async () => {
  const text = el.input.value.trim();
  if (!text) return;

  el.go.disabled = true;
  el.output.textContent = '';
  el.status.className = 'status';
  el.status.textContent = 'Translating…';

  try {
    const result = await translateText(text, settings, {
      onToken: (t) => { el.output.textContent += t; },
    });
    el.status.textContent = result.passthrough
      ? 'Already Arabic — shown unchanged.'
      : `Done · ${settings.model}`;
  } catch (err) {
    el.status.className = 'status error';
    el.status.textContent = err.message;
  } finally {
    el.go.disabled = false;
  }
});

(async function init() {
  settings = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Prefill from the active tab's selection when there is one.
  if (tab?.id) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.getSelection()?.toString() ?? '',
      });
      if (result?.trim()) el.input.value = result.trim();
    } catch { /* privileged page */ }
  }

  // Chrome's built-in PDF viewer cannot expose selection to an extension, so
  // offer to reopen the file in the bundled PDF.js viewer instead. The tab is
  // asked what it is rendering rather than guessed at from the URL: plenty of
  // PDFs are served from paths with no ".pdf" in them.
  const isPdf = tab?.id ? await tabIsPdf(tab.id, tab.url) : false;
  const alreadyInViewer = (tab?.url ?? '').includes('/src/pdfjs/web/viewer.html');

  if (isPdf && !alreadyInViewer) {
    el.pdfBtn.hidden = false;
    if (tab.url.startsWith('file://') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      el.pdfHint.hidden = false;
      el.pdfHint.textContent =
        'Local PDFs need "Allow access to file URLs" enabled on this extension\'s details page.';
    }
    el.pdfBtn.addEventListener('click', async () => {
      // Navigate to the permission gate rather than straight to the viewer.
      // It redirects through instantly when the origin is already granted, and
      // otherwise asks from a real page click -- which the service worker
      // cannot do, because permission requests need user activation and
      // activation does not survive an await.
      const gate = chrome.runtime.getURL('src/pdf/open.html')
        + '?src=' + encodeURIComponent(tab.url);
      await chrome.tabs.update(tab.id, { url: gate });
      window.close();
    });
  }

  try {
    await applyOriginRule(settings.endpoint);

    const client = clientFor(settings);
    const models = await client.listModels(settings.endpoint);

    // First run has no model saved; adopt whatever the server offers rather
    // than reporting the empty default as "not installed".
    const model = pickModel(models, settings.model);
    if (model && model !== settings.model) settings = { ...settings, model };

    el.conn.className = model ? 'dot ok' : 'dot bad';
    el.connText.textContent = model ? `${model} ready` : 'no usable model on that server';
    if (model && settings.autoPreload) client.preloadModel(settings.endpoint, model);
    await reportGpuOffload(settings);
  } catch (err) {
    el.conn.className = 'dot bad';
    el.connText.textContent = err.kind === 'cors' ? 'Server refused the request' : 'Server unreachable';
  }
})();

/**
 * Warn when the model is resident but mostly on the CPU.
 *
 * Ollama offloads silently when a model does not fit in free VRAM, and the
 * only symptom is a 10-30x slowdown with no error. Without this the extension
 * just looks broken.
 *
 * OpenAI-compatible servers expose no equivalent of /api/ps, so their client
 * returns an empty list here and the warning simply never fires.
 */
async function reportGpuOffload(settings) {
  const loaded = await clientFor(settings).listLoadedModels(settings.endpoint);
  const mine = loaded.find((m) => m.name === settings.model);
  if (!mine || !mine.mostlyOnCpu) return;

  const onGpu = Math.round(mine.gpuFraction * 100);
  el.perfWarning.hidden = false;
  el.perfWarning.textContent =
    `Only ${onGpu}% of ${settings.model} fits on the GPU `
    + `(${(mine.sizeVram / 1e9).toFixed(1)} of ${(mine.size / 1e9).toFixed(1)} GB), so it is running `
    + `mostly on the CPU and will be very slow. Free up VRAM, or pick a smaller model in options.`;
}
