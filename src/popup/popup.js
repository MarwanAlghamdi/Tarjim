import { getSettings } from '../shared/settings.js';
import { listModels, listLoadedModels, preloadModel } from '../shared/ollama.js';
import { translateText } from '../shared/translate.js';

const $ = (id) => document.getElementById(id);
const el = {
  conn: $('conn'), connText: $('conn-text'), options: $('options'),
  input: $('input'), go: $('go'), output: $('output'), status: $('status'),
  pdfBtn: $('open-pdf'), pdfHint: $('pdf-hint'), perfWarning: $('perf-warning'),
};

const PDF_URL = /^(https?|file):\/\/.*\.pdf(\?|#|$)/i;

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
  // offer to reopen the file in the bundled PDF.js viewer instead.
  const isPdf = PDF_URL.test(tab?.url ?? '');
  const alreadyInViewer = (tab?.url ?? '').includes('/src/pdfjs/web/viewer.html');

  if (isPdf && !alreadyInViewer) {
    el.pdfBtn.hidden = false;
    if (tab.url.startsWith('file://') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      el.pdfHint.hidden = false;
      el.pdfHint.textContent =
        'Local PDFs need "Allow access to file URLs" enabled on this extension\'s details page.';
    }
    el.pdfBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'open-pdf' });
      if (res?.ok) {
        window.close();
      } else {
        el.pdfHint.hidden = false;
        el.pdfHint.textContent = res?.error ?? 'Could not open the viewer.';
      }
    });
  }

  try {
    const models = await listModels(settings.endpoint);
    const present = models.some((m) => m.name === settings.model);
    el.conn.className = present ? 'dot ok' : 'dot bad';
    el.connText.textContent = present ? `${settings.model} ready` : `${settings.model} not installed`;
    if (present && settings.autoPreload) preloadModel(settings.endpoint, settings.model);
    await reportGpuOffload(settings);
  } catch (err) {
    el.conn.className = 'dot bad';
    el.connText.textContent = err.kind === 'cors' ? 'Ollama refused origin' : 'Ollama unreachable';
  }
})();

/**
 * Warn when the model is resident but mostly on the CPU.
 *
 * Ollama offloads silently when a model does not fit in free VRAM, and the
 * only symptom is a 10-30x slowdown with no error. Without this the extension
 * just looks broken.
 */
async function reportGpuOffload(settings) {
  const loaded = await listLoadedModels(settings.endpoint);
  const mine = loaded.find((m) => m.name === settings.model);
  if (!mine || !mine.mostlyOnCpu) return;

  const onGpu = Math.round(mine.gpuFraction * 100);
  el.perfWarning.hidden = false;
  el.perfWarning.textContent =
    `Only ${onGpu}% of ${settings.model} fits on the GPU `
    + `(${(mine.sizeVram / 1e9).toFixed(1)} of ${(mine.size / 1e9).toFixed(1)} GB), so it is running `
    + `mostly on the CPU and will be very slow. Free up VRAM, or pick a smaller model in options.`;
}
