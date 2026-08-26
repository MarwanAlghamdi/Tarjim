import { getSettings, saveSettings, parseEndpoint, DEFAULT_SETTINGS } from '../shared/settings.js';
import { listModels, preloadModel } from '../shared/ollama.js';

const $ = (id) => document.getElementById(id);

const el = {
  endpoint: $('endpoint'),
  test: $('test'),
  endpointStatus: $('endpoint-status'),
  model: $('model'),
  modelWarning: $('model-warning'),
  autoPreload: $('auto-preload'),
  save: $('save'),
  saveStatus: $('save-status'),
};

/** Cached result of the last successful listModels call. */
let knownModels = [];

function setStatus(node, message, kind = '') {
  node.textContent = message;
  node.className = `status ${kind}`.trim();
  node.hidden = !message;
}

/**
 * Non-localhost endpoints need a runtime host permission, because the manifest
 * only pre-declares localhost. chrome.permissions.request needs a user gesture,
 * which the Save/Test button click provides.
 */
async function ensureHostPermission(url) {
  const origin = `${new URL(url).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function refreshModels(endpoint, selected) {
  knownModels = await listModels(endpoint);

  el.model.innerHTML = '';
  const usable = knownModels.filter((m) => !m.isEmbedding);

  for (const m of usable) {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.isThinking
      ? `${m.name} (${m.parameterSize}) — reasoning model, not recommended`
      : `${m.name} (${m.parameterSize})`;
    el.model.appendChild(opt);
  }

  if (selected && usable.some((m) => m.name === selected)) {
    el.model.value = selected;
  } else if (usable.some((m) => m.name === DEFAULT_SETTINGS.model)) {
    el.model.value = DEFAULT_SETTINGS.model;
  }

  updateModelWarning();
  return usable.length;
}

function updateModelWarning() {
  const chosen = knownModels.find((m) => m.name === el.model.value);
  if (chosen?.isThinking) {
    setStatus(
      el.modelWarning,
      'This model emits <think> reasoning that Ollama 0.32.3 does not suppress, '
      + 'which can consume the whole output budget and return no translation. Prefer gemma3:12b.',
      'warn',
    );
  } else {
    setStatus(el.modelWarning, '');
  }
}

el.model.addEventListener('change', updateModelWarning);

el.test.addEventListener('click', async () => {
  const parsed = parseEndpoint(el.endpoint.value);
  if (!parsed.ok) {
    setStatus(el.endpointStatus, parsed.error, 'error');
    return;
  }

  el.test.disabled = true;
  setStatus(el.endpointStatus, 'Connecting…');

  try {
    if (!(await ensureHostPermission(parsed.url))) {
      setStatus(el.endpointStatus, 'Permission for that host was denied.', 'error');
      return;
    }

    const count = await refreshModels(parsed.url, el.model.value);
    el.endpoint.value = parsed.url;
    setStatus(el.endpointStatus, `Connected — ${count} usable model(s).`, 'ok');
  } catch (err) {
    const hint = err.kind === 'cors' ? ' Run tools/setup-ollama-cors.sh and restart Ollama.' : '';
    setStatus(el.endpointStatus, `${err.message}${hint}`, 'error');
  } finally {
    el.test.disabled = false;
  }
});

el.save.addEventListener('click', async () => {
  const parsed = parseEndpoint(el.endpoint.value);
  if (!parsed.ok) {
    setStatus(el.saveStatus, parsed.error, 'error');
    return;
  }

  try {
    if (!(await ensureHostPermission(parsed.url))) {
      setStatus(el.saveStatus, 'Permission for that host was denied.', 'error');
      return;
    }

    const saved = await saveSettings({
      endpoint: parsed.url,
      model: el.model.value || DEFAULT_SETTINGS.model,
      autoPreload: el.autoPreload.checked,
    });

    el.endpoint.value = saved.endpoint;
    setStatus(el.saveStatus, 'Saved.', 'ok');
    if (saved.autoPreload) preloadModel(saved.endpoint, saved.model);
    setTimeout(() => setStatus(el.saveStatus, ''), 2500);
  } catch (err) {
    setStatus(el.saveStatus, err.message, 'error');
  }
});

(async function init() {
  const settings = await getSettings();
  el.endpoint.value = settings.endpoint;
  el.autoPreload.checked = settings.autoPreload;

  try {
    await refreshModels(settings.endpoint, settings.model);
  } catch {
    el.model.innerHTML = `<option value="${settings.model}">${settings.model}</option>`;
    setStatus(el.endpointStatus, 'Could not reach Ollama — press "Test connection".', 'warn');
  }
})();
