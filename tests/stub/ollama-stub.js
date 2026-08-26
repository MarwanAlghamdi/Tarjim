import http from 'node:http';

const NDJSON = 'application/x-ndjson';

const TAGS = {
  models: [
    { name: 'gemma3:12b', model: 'gemma3:12b', capabilities: ['completion'], details: { parameter_size: '12.2B' } },
    { name: 'qwen3:14b', model: 'qwen3:14b', capabilities: ['completion', 'thinking'], details: { parameter_size: '14.8B' } },
    { name: 'bge-m3:latest', model: 'bge-m3:latest', capabilities: ['embedding'], details: { parameter_size: '566.70M' } },
  ],
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/** Deterministic pseudo-Arabic so assertions do not depend on a real model. */
function tokensFor(prompt) {
  return ['ترجمة', ' تجريبية', ` (${String(prompt).trim().slice(0, 12)})`];
}

/**
 * @param {object}  opts
 * @param {boolean} opts.cpuOffload  report the model as mostly evicted to CPU,
 *                                   which is what Ollama does when a model does
 *                                   not fit in free VRAM.
 */
export function createOllamaStub({ port = 0, delayMs = 5, cpuOffload = false } = {}) {
  // Every /api/generate body, so tests can assert exactly what was requested
  // (a preload has no `prompt`; a real translation does).
  const calls = [];

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(origin));
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { ...cors(origin), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(TAGS));
    }

    if (req.method === 'GET' && req.url === '/api/ps') {
      res.writeHead(200, { ...cors(origin), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        models: [{
          name: 'gemma3:12b',
          model: 'gemma3:12b',
          size: 8_900_000_000,
          size_vram: cpuOffload ? 100_000_000 : 8_900_000_000,
          context_length: 8192,
        }],
      }));
    }

    if (req.method === 'POST' && req.url === '/api/generate') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', async () => {
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          res.writeHead(400, cors(origin));
          return res.end('invalid json');
        }

        calls.push(payload);

        if (payload.model === 'missing:1b') {
          res.writeHead(404, { ...cors(origin), 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `model '${payload.model}' not found` }));
        }

        res.writeHead(200, { ...cors(origin), 'Content-Type': NDJSON });

        // A prompt-less body is a preload; Ollama returns without generating.
        if (payload.prompt === undefined) {
          return res.end(JSON.stringify({
            model: payload.model, response: '', done: true, done_reason: 'load',
          }) + '\n');
        }

        for (const token of tokensFor(payload.prompt)) {
          res.write(JSON.stringify({ model: payload.model, response: token, done: false }) + '\n');
          await new Promise((r) => setTimeout(r, delayMs));
        }
        return res.end(JSON.stringify({
          model: payload.model, response: '', done: true, done_reason: 'stop',
          eval_count: 3, total_duration: 1_000_000, load_duration: 1_000,
        }) + '\n');
      });
      return;
    }

    res.writeHead(404, cors(origin));
    res.end('not found');
  });

  server.calls = calls;
  server.generateCalls = () => calls.filter((c) => c.prompt !== undefined);

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// `node tests/stub/ollama-stub.js` for manual poking.
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await createOllamaStub({ port: 11500 });
  console.log('stub on http://127.0.0.1:' + s.address().port);
}
