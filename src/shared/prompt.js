/**
 * The system prompt below was validated against gemma3:12b on eight cases --
 * plain text, preamble bait ("Translate this for me please: Good evening."),
 * URLs plus backticked shell commands, mixed Arabic/English, French, Chinese,
 * multi-paragraph, and a single word. All eight produced translation-only
 * output with URLs, code and line breaks preserved byte-for-byte.
 *
 * The tashkeel rule is here because the only defect that pass found was
 * unrequested diacritics on the output.
 */
export const SYSTEM_PROMPT = `You are a translation engine. Translate the user's text into Modern Standard Arabic (الفصحى).
Rules:
- Output ONLY the Arabic translation. No preamble, no explanation, no notes, no surrounding quotation marks.
- Use Arabic script exclusively. Never romanize or transliterate.
- Preserve the original line breaks and paragraph structure exactly.
- Preserve URLs, code, file paths, numbers, and email addresses verbatim.
- Do not add diacritics (tashkeel) unless they appear in the source text.
- Translate from whatever language the source is in; do not ask which language it is.
- Never add commentary, alternatives, or a translator's note.`;

export const DEFAULT_OPTIONS = Object.freeze({
  temperature: 0.2,
  top_p: 0.9,
  num_ctx: 8192,
  num_predict: 2048,
});

/**
 * Build a POST /api/generate body.
 *
 * Omitting `text` yields a preload body -- Ollama loads the model into VRAM
 * and returns without generating. That is the mechanism the service worker
 * uses to hide the 24.5s cold time-to-first-byte measured on gemma3:12b.
 */
export function buildGenerateBody({
  model,
  text,
  keepAlive = '30m',
  numCtx = DEFAULT_OPTIONS.num_ctx,
  numPredict = DEFAULT_OPTIONS.num_predict,
  temperature = DEFAULT_OPTIONS.temperature,
} = {}) {
  const isPreload = text === undefined || text === null;

  const body = {
    model,
    stream: !isPreload,
    keep_alive: keepAlive,
    // Sent for defence in depth. Verified NOT honoured by qwen3 on Ollama
    // 0.32.3, which is why src/shared/text.js strips <think> regardless.
    think: false,
    options: {
      ...DEFAULT_OPTIONS,
      temperature,
      num_ctx: numCtx,
      num_predict: numPredict,
    },
  };

  if (!isPreload) {
    body.prompt = text;
    body.system = SYSTEM_PROMPT;
  }
  return body;
}
