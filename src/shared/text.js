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

// Letters that Modern Standard Arabic itself uses, plus tatweel and alef wasla.
//
// This is deliberately NARROWER than the Arabic Unicode block. Persian, Urdu
// and Pashto are written in the same block but with extra letters -- Persian
// pe/che/zhe/gaf/farsi-yeh (U+067E, U+0686, U+0698, U+06AF, U+06CC), Urdu
// tteh/ddal/rreh/heh-doachashmee/yeh-barree (U+0679, U+0688, U+0691, U+06BE,
// U+06D2), and so on. A range covering the whole block classifies Persian and
// Urdu as "already Arabic" and passes them through untranslated, which is
// exactly the case this extension exists to handle.
const AR_LETTERS =
  '\\u0621-\\u063A\\u0640-\\u064A\\u0671'
  // Arabic ligatures and presentation forms (e.g. U+FDF2 Allah).
  + '\\uFDF0-\\uFDFF\\uFE70-\\uFEFF';

// Harakat and other marks that legitimately appear in Arabic text.
const AR_MARKS = '\\u064B-\\u0655\\u0670';

// Arabic-script punctuation (comma, semicolon, question mark, percent, full stop).
const AR_PUNCT = '\\u060C\\u061B\\u061F\\u066A-\\u066D\\u06D4';

const ARABIC_LETTER = new RegExp(`[${AR_LETTERS}]`, 'u');

// Any character that is a letter from outside the Arabic-language set. Digits
// (of any script), whitespace, punctuation, symbols, marks and format
// characters are all ignored, so "chapter 3: intro (2024)" written in Arabic
// still counts as Arabic-only.
const NON_ARABIC_LETTER = new RegExp(
  `[^${AR_LETTERS}${AR_MARKS}${AR_PUNCT}\\s\\p{N}\\p{P}\\p{S}\\p{Cf}]`,
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
