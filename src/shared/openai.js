/**
 * OpenAI-compatible chat client -- llama.cpp's `llama-server`, LM Studio, vLLM.
 *
 * None of those serve Ollama's native paths, which is why pointing the
 * extension at `llama-server --host 0.0.0.0 --port 8081` produced a 404 on
 * every request: /api/tags and /api/generate simply do not exist there. They
 * expose /v1/models and /v1/chat/completions instead, framed as SSE rather
 * than NDJSON.
 *
 * The export surface deliberately mirrors src/shared/ollama.js so
 * src/shared/backend.js can pick one and hand it to callers unchanged.
 */
import { OllamaError } from './ollama.js';
import { SYSTEM_PROMPT, DEFAULT_OPTIONS } from './prompt.js';
import { normalizeEndpoint } from './settings.js';

function toBackendError(err) {
  if (err instanceof OllamaError) return err;
  if (err?.name === 'AbortError') return new OllamaError('Translation cancelled.', 'aborted');
  return new OllamaError(
    'Cannot reach the server. Check that it is running, that it was started with '
    + '--host 0.0.0.0 if it is on another machine, and that the port is correct.',
    'offline',
  );
}

/**
 * OpenAI's error envelope is {error:{message}}; llama.cpp sometimes answers
 * with a bare {error:"..."} instead, so both shapes are read.
 *
 * A 403 is NOT mapped to kind 'cors' here the way it is for Ollama: llama.cpp
 * sends Access-Control-Allow-Origin:* by default, and a browser-blocked
 * request never reaches this function -- it rejects fetch as a TypeError.
 */
async function errorFromResponse(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? '');
  } catch {
    /* body was not JSON */
  }

  if (res.status === 404) {
    return new OllamaError(detail || 'Model not found on the server.', 'model-missing');
  }
  return new OllamaError(detail || `Server returned HTTP ${res.status}.`, 'http');
}

/** GET /v1/models. */
export async function listModels(endpoint) {
  let res;
  try {
    res = await fetch(`${normalizeEndpoint(endpoint)}/v1/models`);
  } catch (err) {
    throw toBackendError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);

  const data = await res.json();
  return (data.data ?? []).map((m) => ({
    name: m.id ?? '',
    capabilities: [],
    // /v1/models carries no size or capability metadata -- it is an id list.
    parameterSize: '',
    // Unlike Ollama, a reasoning model is not a problem here: llama.cpp splits
    // the <think> block into delta.reasoning_content, which streamGenerate
    // ignores, and buildBody asks the chat template to disable it outright.
    isThinking: false,
    isEmbedding: false,
  }));
}

/** No equivalent of /api/ps: llama-server holds exactly one model, from launch. */
export async function listLoadedModels() {
  return [];
}

/** No-op: the model is resident before the server accepts its first request. */
export async function preloadModel() {}

/** Build a POST /v1/chat/completions body. */
export function buildBody({
  model,
  text,
  numPredict = DEFAULT_OPTIONS.num_predict,
  temperature = DEFAULT_OPTIONS.temperature,
} = {}) {
  return {
    model,
    stream: true,
    temperature,
    top_p: DEFAULT_OPTIONS.top_p,
    max_tokens: numPredict,
    // Qwen3 and friends emit a <think> block by default, which can eat the
    // whole output budget. llama.cpp forwards this to the chat template;
    // servers that do not understand it ignore it, and src/shared/text.js
    // strips <think> regardless.
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  };
}

/**
 * POST /v1/chat/completions with stream:true, parsing the SSE body.
 *
 * Same buffering discipline as the Ollama reader: one network chunk is not one
 * SSE line, and TextDecoder runs with {stream:true} so a multi-byte Arabic
 * character split across a chunk boundary is not corrupted.
 */
export async function streamGenerate(endpoint, body, { signal, onToken } = {}) {
  let res;
  try {
    res = await fetch(`${normalizeEndpoint(endpoint)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw toBackendError(err);
  }

  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new OllamaError('The server returned an empty response body.', 'http');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';
  let doneReason;
  let evalCount;

  const consume = (line) => {
    const trimmed = line.trim();
    // ':' prefixes an SSE comment, which llama.cpp uses as a keep-alive ping.
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return;

    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;

    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // tolerate a malformed frame rather than abort the stream
    }

    if (json.error) {
      const message = typeof json.error === 'string'
        ? json.error
        : (json.error.message ?? 'The server reported an error.');
      throw new OllamaError(message, 'http');
    }

    const choice = json.choices?.[0];
    const token = choice?.delta?.content ?? '';
    if (token) {
      text += token;
      onToken?.(token);
    }
    if (choice?.finish_reason) doneReason = choice.finish_reason;
    if (json.usage?.completion_tokens != null) evalCount = json.usage.completion_tokens;
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
    consume(buffer); // flush a trailing frame with no terminator
  } catch (err) {
    throw toBackendError(err);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  return { text, doneReason, evalCount };
}
