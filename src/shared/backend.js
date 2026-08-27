/**
 * Which dialect a local model server speaks.
 *
 * Ollama's native API (/api/tags, /api/generate, NDJSON) and the
 * OpenAI-compatible API that llama.cpp's `llama-server`, LM Studio and vLLM
 * expose (/v1/models, /v1/chat/completions, SSE) share no paths and no body
 * shape. Without this the extension answered every llama-server request with
 * "Cannot reach Ollama", because /api/tags 404s there.
 *
 * The dialect is detected once -- when the endpoint is tested or saved -- and
 * stored in settings. Probing per request would cost an extra round trip on
 * every chunk of every translation.
 */
import * as ollama from './ollama.js';
import * as openai from './openai.js';
import { normalizeEndpoint } from './settings.js';

export const BACKENDS = Object.freeze({ OLLAMA: 'ollama', OPENAI: 'openai' });

export const BACKEND_LABELS = Object.freeze({
  [BACKENDS.OLLAMA]: 'Ollama',
  [BACKENDS.OPENAI]: 'OpenAI-compatible server',
});

/**
 * The client module for these settings.
 *
 * Both modules export the same surface -- listModels, listLoadedModels,
 * preloadModel, buildBody, streamGenerate -- so callers need no branches.
 */
export function clientFor(settings) {
  return settings?.backend === BACKENDS.OPENAI ? openai : ollama;
}

/**
 * Probe an endpoint and return its dialect, or null when nothing answers.
 *
 * Ollama serves /v1/models too, so its native path must win: a hit on
 * /api/tags is the only proof that the extra Ollama-only features (model
 * capabilities, preload, the /api/ps GPU-offload warning) are available.
 *
 * Returning null rather than guessing matters -- an unreachable server must
 * not silently rewrite a working stored backend to the wrong one.
 */
export async function detectBackend(endpoint) {
  const base = normalizeEndpoint(endpoint);

  const [tags, models] = await Promise.allSettled([
    fetch(`${base}/api/tags`),
    fetch(`${base}/v1/models`),
  ]);

  if (tags.status === 'fulfilled' && tags.value.ok) return BACKENDS.OLLAMA;
  if (models.status === 'fulfilled' && models.value.ok) return BACKENDS.OPENAI;
  return null;
}
