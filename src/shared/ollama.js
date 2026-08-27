import { buildGenerateBody } from './prompt.js';
import { normalizeEndpoint } from './settings.js';

// Named buildBody so this module and src/shared/openai.js present the same
// surface to src/shared/backend.js.
export { buildGenerateBody as buildBody };

/** An Ollama failure with a `kind` the UI can turn into an actionable message. */
export class OllamaError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'OllamaError';
    this.kind = kind;
  }
}

/** Translate a thrown fetch rejection into an OllamaError. */
function toOllamaError(err) {
  if (err instanceof OllamaError) return err;
  if (err?.name === 'AbortError') return new OllamaError('Translation cancelled.', 'aborted');
  // A refused connection and a browser-blocked CORS request are both TypeError
  // in fetch; a reachable-but-refusing Ollama answers 403, handled below.
  return new OllamaError(
    'Cannot reach Ollama. Check that it is running and the endpoint is correct.',
    'offline',
  );
}

/** Turn a non-2xx response into an OllamaError, reading the server's message. */
async function errorFromResponse(res) {
  if (res.status === 403) {
    return new OllamaError(
      "Ollama refused the extension's origin (403). Run tools/setup-ollama-cors.sh.",
      'cors',
    );
  }

  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error ?? '';
  } catch {
    /* body was not JSON */
  }

  if (res.status === 404) {
    return new OllamaError(detail || 'Model not found on the Ollama server.', 'model-missing');
  }
  return new OllamaError(detail || `Ollama returned HTTP ${res.status}.`, 'http');
}

/** GET /api/tags, annotated so the options page can warn about unusable models. */
export async function listModels(endpoint) {
  let res;
  try {
    res = await fetch(`${normalizeEndpoint(endpoint)}/api/tags`);
  } catch (err) {
    throw toOllamaError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);

  const data = await res.json();
  return (data.models ?? []).map((m) => {
    const capabilities = m.capabilities ?? [];
    return {
      name: m.name,
      capabilities,
      parameterSize: m.details?.parameter_size ?? '',
      // qwen3 reports "thinking" and ignores think:false on Ollama 0.32.3.
      isThinking: capabilities.includes('thinking'),
      isEmbedding: capabilities.includes('embedding'),
    };
  });
}

/**
 * GET /api/ps -- which models are resident, and how much of each is actually
 * on the GPU.
 *
 * This exists because a model that does not fit in free VRAM is silently
 * offloaded to CPU by Ollama and runs 10-30x slower, with no error anywhere.
 * Observed on this machine: another process held 14.4 GB of a 16 GB card, so
 * gemma3:12b loaded with 0.1 GB of 8.9 GB on the GPU and a one-sentence
 * translation took 33 seconds instead of 2. Surfacing it turns a "the
 * extension is broken" report into "something else is using your GPU".
 *
 * Purely diagnostic, so it never throws.
 */
export async function listLoadedModels(endpoint) {
  try {
    const res = await fetch(`${normalizeEndpoint(endpoint)}/api/ps`);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.models ?? []).map((m) => {
      const size = m.size ?? 0;
      const sizeVram = m.size_vram ?? 0;
      const gpuFraction = size > 0 ? sizeVram / size : 1;
      return {
        name: m.name,
        size,
        sizeVram,
        gpuFraction,
        contextLength: m.context_length,
        expiresAt: m.expires_at,
        // Below half on the GPU is where the slowdown becomes obvious.
        mostlyOnCpu: size > 0 && gpuFraction < 0.5,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fire-and-forget model load.
 *
 * Never throws: it is called speculatively (the moment a selection bubble
 * appears) and a failure here must not surface as a user-facing error. Ollama
 * continues loading server-side even if this request's caller is torn down,
 * which is what makes it survive MV3 service-worker termination.
 */
export async function preloadModel(endpoint, model) {
  if (!model) return;
  try {
    await fetch(`${normalizeEndpoint(endpoint)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGenerateBody({ model })),
    });
  } catch {
    /* speculative -- ignore */
  }
}

/**
 * POST /api/generate with stream:true, parsing the NDJSON body.
 *
 * Lines are buffered across reads because one network chunk is not one JSON
 * line, and TextDecoder is used with {stream:true} so multi-byte Arabic
 * characters split across a chunk boundary are not corrupted.
 */
export async function streamGenerate(endpoint, body, { signal, onToken } = {}) {
  let res;
  try {
    res = await fetch(`${normalizeEndpoint(endpoint)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw toOllamaError(err);
  }

  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new OllamaError('Ollama returned an empty response body.', 'http');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';
  let doneReason;
  let evalCount;

  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return; // tolerate a malformed line rather than abort the stream
    }

    if (json.error) throw new OllamaError(json.error, 'http');
    if (json.response) {
      text += json.response;
      onToken?.(json.response);
    }
    if (json.done) {
      doneReason = json.done_reason;
      evalCount = json.eval_count;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        consume(line);
      }
    }
    consume(buffer); // flush a trailing line with no terminator
  } catch (err) {
    throw toOllamaError(err);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  return { text, doneReason, evalCount };
}
