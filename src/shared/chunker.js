/**
 * Split text for translation.
 *
 * The budget is characters, not tokens, and is deliberately conservative
 * (1800) so the extension also works with iKhalid/ALLaM:7b, whose context
 * ceiling is 4096 tokens (llama.context_length via /api/show).
 *
 * Splitting on paragraph boundaries first matters for output quality: the
 * model was verified to preserve \n and \n\n exactly, so rejoining translated
 * chunks with the original separators reproduces the source layout.
 */
export function splitIntoChunks(text, maxChars = 1800) {
  const source = String(text ?? '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const chunks = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of source.split(/\n{2,}/)) {
    const para = paragraph.trim();
    if (!para) continue;

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    push();
    if (para.length <= maxChars) {
      current = para;
      continue;
    }

    for (const piece of splitLongParagraph(para, maxChars)) {
      if (current && current.length + 1 + piece.length > maxChars) push();
      current = current ? `${current} ${piece}` : piece;
    }
  }

  push();
  return chunks;
}

/** Sentence-boundary split, with a hard character cut for unbroken runs. */
function splitLongParagraph(paragraph, maxChars) {
  const sentences = paragraph.match(/[^.!?؟。]+[.!?؟。]*\s*/g) ?? [paragraph];
  const out = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    for (let i = 0; i < sentence.length; i += maxChars) {
      out.push(sentence.slice(i, i + maxChars));
    }
  }
  return out;
}
