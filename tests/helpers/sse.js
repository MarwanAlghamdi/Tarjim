/** Build a Response whose body streams the given objects as OpenAI-style SSE. */
export function sseResponse(objects, { status = 200, splitAt, done = true } = {}) {
  const encoder = new TextEncoder();
  let payload = objects.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('');
  if (done) payload += 'data: [DONE]\n\n';

  const pieces = typeof splitAt === 'number'
    ? [payload.slice(0, splitAt), payload.slice(splitAt)]
    : [payload];

  const stream = new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });

  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

/** One streamed chat-completion delta. */
export function delta(content, finishReason = null) {
  return { choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finishReason }] };
}
