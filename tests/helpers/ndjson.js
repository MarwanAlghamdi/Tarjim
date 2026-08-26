/** Build a Response whose body streams the given objects as NDJSON, one per line. */
export function ndjsonResponse(objects, { status = 200, splitAt } = {}) {
  const encoder = new TextEncoder();
  const payload = objects.map((o) => JSON.stringify(o) + '\n').join('');

  // `splitAt` cuts the payload at an arbitrary offset so tests can prove the
  // parser reassembles JSON lines across chunk boundaries.
  const pieces = typeof splitAt === 'number'
    ? [payload.slice(0, splitAt), payload.slice(splitAt)]
    : [payload];

  const stream = new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });

  return new Response(stream, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
