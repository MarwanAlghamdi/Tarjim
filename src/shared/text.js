/**
 * Text normalisation for model output and input routing.
 *
 * Two behaviours here exist because of defects measured against real models:
 *  - qwen3 emits <think> reasoning even when `think:false` is sent (verified on
 *    both /api/generate and /api/chat, Ollama 0.32.3), so it is stripped here
 *    unconditionally rather than trusted to the API parameter.
 *  - Arabic input is not reliably passed through by prompting: ALLaM:7b turned
 *    "as-salamu alaykum" into a *reply* to the greeting. Arabic-only input is
 *    detected here and never reaches a model.
 */

// Arabic, Arabic Supplement, Extended-A/B, Presentation Forms-A/B.
const ARABIC_RANGES =
  '\\u0600-\\u06FF\\u0750-\\u077F\\u0870-\\u089F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';

const ARABIC_LETTER = new RegExp(`[${ARABIC_RANGES}]`, 'u');

// Anything that is a letter from some other script. Whitespace, digits,
// punctuation, symbols, combining marks and format characters are ignored so
// that "chapter 3: intro (2024)" written in Arabic still counts as Arabic-only.
const NON_ARABIC_LETTER = new RegExp(
  `[^${ARABIC_RANGES}\\s\\d\\p{P}\\p{S}\\p{M}\\p{Cf}]`,
  'u',
);

const PREAMBLE =
  /^\s*(?:here\s+is\s+(?:the\s+)?translation|translation|arabic\s+translation|translated\s+text)\s*:?\s*/i;

const QUOTE_PAIRS = [['"', '"'], ["'", "'"], ['«', '»'], ['“', '”'], ['‘', '’']];

/** Remove <think>...</think> reasoning, including an unterminated trailing block. */
export function stripThinkBlocks(input) {
  return String(input ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '');
}

/**
 * True when the text contains Arabic letters and no letters from any other
 * script.
 */
export function isArabicOnly(input) {
  const s = String(input ?? '');
  if (!ARABIC_LETTER.test(s)) return false;
  return !NON_ARABIC_LETTER.test(s);
}

/** Clean one model response: strip reasoning, preamble, wrapping quotes, and pad. */
export function sanitizeTranslation(input) {
  let s = stripThinkBlocks(input).trim();
  s = s.replace(PREAMBLE, '').trim();

  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, -close.length).trim();
      break;
    }
  }
  return s;
}
