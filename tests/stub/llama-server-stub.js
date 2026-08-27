import http from 'node:http';

/**
 * A llama.cpp `llama-server` shaped stub: OpenAI-compatible paths only.
 *
 * /api/tags deliberately 404s, which is exactly what made the extension
 * unusable against a real llama-server and is what detectBackend keys on.
 */
const MODEL_ID = 'unsloth/Qwen3-27B-GGUF:UD-Q4_K_M';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function tokensFor(text) {
  const tag = String(text).trim().slice(0, 14);
  return ['ترجمة', ' تجريبية', ` [${tag}]`];
}

function frame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function createLlamaServerStub({ port = 0, delayMs = 5 } = {}) {
  const calls = [];

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(origin));
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { ...cors(origin), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }));
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
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

        res.writeHead(200, { ...cors(origin), 'Content-Type': 'text/event-stream' });

        // A real Qwen3 run emits reasoning first; it must not reach the panel.
        res.write(frame({ choices: [{ index: 0, delta: { reasoning_content: 'thinking…' } }] }));

        const prompt = payload.messages?.at(-1)?.content ?? '';
        for (const token of tokensFor(prompt)) {
          res.write(frame({ choices: [{ index: 0, delta: { content: token }, finish_reason: null }] }));
          await new Promise((r) => setTimeout(r, delayMs));
        }
        res.write(frame({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { completion_tokens: 3 },
        }));
        return res.end('data: [DONE]\n\n');
      });
      return;
    }

    // Everything Ollama-native, including /api/tags and /api/generate.
    res.writeHead(404, cors(origin));
    res.end('not found');
  });

  server.calls = calls;
  server.modelId = MODEL_ID;

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// `node tests/stub/llama-server-stub.js` for manual poking.
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await createLlamaServerStub({ port: 8081 });
  console.log('llama-server stub on http://127.0.0.1:' + s.address().port);
}
