import { isArabicOnly, sanitizeTranslation } from './text.js';
import { splitIntoChunks } from './chunker.js';
import { clientFor } from './backend.js';

/**
 * Translate a selection into Arabic.
 *
 * `deps` exists so tests can inject a fake streamGenerate without stubbing
 * global fetch through three layers.
 */
export async function translateText(
  rawText,
  settings,
  { signal, onToken, onProgress, deps = {} } = {},
) {
  // The client is picked from settings.backend: Ollama's /api/generate and a
  // llama-server's /v1/chat/completions need different paths AND different
  // body shapes, so the body builder has to travel with the stream function.
  const client = clientFor(settings);
  const streamGenerate = deps.streamGenerate ?? client.streamGenerate;
  const text = String(rawText ?? '').trim();

  if (!text) throw new Error('There is nothing to translate.');

  // Verified failure mode: prompting a model to "return Arabic unchanged" does
  // not work -- ALLaM:7b replied to a greeting instead of echoing it. Detect
  // and return before any model sees it.
  if (isArabicOnly(text)) {
    onToken?.(text);
    return { text, passthrough: true, chunks: 0 };
  }

  const chunks = splitIntoChunks(text, settings.maxChunkChars);
  const out = [];

  for (let i = 0; i < chunks.length; i += 1) {
    onProgress?.({ chunk: i + 1, total: chunks.length });

    const body = client.buildBody({
      model: settings.model,
      text: chunks[i],
      keepAlive: settings.keepAlive,
      numCtx: settings.numCtx,
    });

    // A blank line is emitted between chunks so the panel keeps paragraph
    // shape while streaming, matching how the chunks were split.
    if (i > 0) onToken?.('\n\n');

    const { text: chunkText } = await streamGenerate(settings.endpoint, body, { signal, onToken });
    out.push(sanitizeTranslation(chunkText));
  }

  return { text: out.join('\n\n'), passthrough: false, chunks: chunks.length };
}
