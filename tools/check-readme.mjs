/**
 * Lint the documentation the way the README is meant to be read.
 *
 *   node tools/check-readme.mjs <images|links|commands|shape|preserved|selftest|all>
 *
 * Each mode prints "check-readme <mode> PASS" only after every assertion in it
 * has passed, and exits non-zero otherwise. `selftest` runs every mode against
 * a deliberately broken fixture tree and fails if any mode reports that tree as
 * clean -- a checker that cannot fail proves nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIN_IMAGES = 4;
const MIN_IMAGE_BYTES = 10_000;
const MIN_IMAGE_PX = { width: 300, height: 150 };
const MAX_LIST_RUN = 5;
const ACTION_WITHIN_LINES = 25;

/**
 * Identifiers that must never appear in anything published: the author's own
 * LAN address, a home directory, or an extension ID (a hash of the private
 * signing key). The documentation example address is allowlisted so the check
 * cannot be satisfied by deleting the examples.
 */
const PRIVATE = [
  { name: 'a private LAN address', re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
    allow: new Set(['192.168.1.50', '10.0.0.0']) },
  { name: 'a home directory path', re: /\/(?:home|Users)\/[a-z][\w.-]*/gi, allow: new Set() },
  { name: 'an extension ID', re: /\b[a-p]{32}\b/g, allow: new Set(['abcdefghijklmnopabcdefghijklmnop']) },
];

const BANNED = [
  'hope this helps', 'let me know if', 'feel free to ask',
  'great question', 'in this document we will', 'as an ai',
];

/* ------------------------------------------------------------------ context */

function docFiles(root) {
  const out = [];
  for (const top of ['README.md', 'CLAUDE.md']) {
    const f = path.join(root, top);
    if (fs.existsSync(f)) out.push(f);
  }
  const docs = path.join(root, 'docs');
  if (fs.existsSync(docs)) {
    for (const f of fs.readdirSync(docs)) {
      if (f.endsWith('.md')) out.push(path.join(docs, f));
    }
  }
  return out;
}

function loadContext(root) {
  const docs = new Map(docFiles(root).map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const pkgPath = path.join(root, 'package.json');
  return {
    root,
    docs,
    readme: docs.get(path.join(root, 'README.md')) ?? '',
    pkg: fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : { scripts: {} },
  };
}

/* -------------------------------------------------------------------- modes */

function images(ctx) {
  const dir = path.join(ctx.root, 'docs/images');
  const problems = [];
  if (!fs.existsSync(dir)) return ['docs/images/ does not exist'];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  if (files.length < MIN_IMAGES) problems.push(`only ${files.length} png(s), want >= ${MIN_IMAGES}`);

  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      problems.push(`${f}: not a PNG`);
      continue;
    }
    if (buf.length < MIN_IMAGE_BYTES) problems.push(`${f}: ${buf.length} bytes, likely blank`);
    // IHDR width/height are the two big-endian uint32 after the 8-byte magic,
    // 4-byte length and 4-byte "IHDR" type.
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width < MIN_IMAGE_PX.width || height < MIN_IMAGE_PX.height) {
      problems.push(`${f}: ${width}x${height} is too small to read`);
    }
  }
  return problems;
}

function links(ctx) {
  const problems = [];
  const anchors = new Map();

  for (const [file, body] of ctx.docs) {
    anchors.set(file, new Set(
      [...body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(([, h]) =>
        h.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')),
    ));
  }

  for (const [file, body] of ctx.docs) {
    const targets = [
      ...[...body.matchAll(/]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]),
      ...[...body.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const target of targets) {
      if (/^[a-z]+:/i.test(target) || target.startsWith('//')) continue;
      const name = path.relative(ctx.root, file);
      if (target.startsWith('#')) {
        if (!anchors.get(file).has(target.slice(1))) problems.push(`${name}: dead anchor ${target}`);
        continue;
      }
      const [rel, hash] = target.split('#');
      const resolved = path.resolve(path.dirname(file), rel);
      if (!fs.existsSync(resolved)) {
        problems.push(`${name}: missing ${rel}`);
      } else if (hash) {
        const other = anchors.get(resolved);
        if (other && !other.has(hash)) problems.push(`${name}: dead anchor ${target}`);
      }
    }
  }
  return problems;
}

function commands(ctx) {
  const problems = [];
  const scripts = new Set(Object.keys(ctx.pkg.scripts ?? {}));

  for (const [file, body] of ctx.docs) {
    const name = path.relative(ctx.root, file);
    for (const [, script] of body.matchAll(/npm run ([a-z][\w:-]*)/g)) {
      if (!scripts.has(script)) problems.push(`${name}: npm run ${script} is not in package.json`);
    }
    for (const [, tool] of body.matchAll(/\b(tools\/[\w.-]+)/g)) {
      if (!fs.existsSync(path.join(ctx.root, tool))) problems.push(`${name}: ${tool} does not exist`);
    }
  }
  return problems;
}

function shape(ctx) {
  const problems = [];
  const lines = ctx.readme.split('\n');
  const lower = ctx.readme.toLowerCase();

  for (const phrase of BANNED) {
    if (lower.includes(phrase)) problems.push(`banned filler phrase: "${phrase}"`);
  }

  const actionAt = lines.findIndex((l) => /^```/.test(l) || /^\s*1\.\s+\S/.test(l));
  if (actionAt === -1 || actionAt >= ACTION_WITHIN_LINES) {
    problems.push(`no command block or numbered step in the first ${ACTION_WITHIN_LINES} lines`);
  }

  if (!/^\s*1\.\s+\S/m.test(ctx.readme)) problems.push('no numbered steps anywhere');

  for (const line of lines) {
    if (/^#{4,}\s/.test(line)) problems.push(`heading deeper than h3: ${line.trim()}`);
  }

  // Longest run of consecutive list items, ignoring fenced code.
  let run = 0;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) {
      run += 1;
      if (run > MAX_LIST_RUN) { problems.push(`list run of ${run} items, cap is ${MAX_LIST_RUN}`); break; }
    } else if (line.trim() !== '' && !/^\s{2,}\S/.test(line)) {
      run = 0;
    }
  }
  return problems;
}

/**
 * Nothing published may carry a private identifier. This covers the docs AND
 * the strings shipped inside the extension, because the options page help text
 * is read by every user of a release.
 */
function privacy(ctx) {
  const problems = [];
  const targets = new Map(ctx.docs);

  for (const rel of ['src/options/options.html', 'src/popup/popup.html', 'src/shared/settings.js',
                     'src/shared/defaults.js', 'manifest.json', 'src/options/options.js']) {
    const file = path.join(ctx.root, rel);
    if (fs.existsSync(file)) targets.set(file, fs.readFileSync(file, 'utf8'));
  }

  for (const [file, body] of targets) {
    const name = path.relative(ctx.root, file);
    for (const { name: what, re, allow } of PRIVATE) {
      for (const [hit] of body.matchAll(re)) {
        if (!allow.has(hit)) problems.push(`${name}: ${what} -- ${hit}`);
      }
    }
  }
  return problems;
}

/**
 * Nothing may pin the user to one browser, one server product, or one model.
 * "Load it and point it at your server" is the whole setup, and each of these
 * strings would quietly add a step back.
 */
function nohardcode(ctx) {
  const problems = [];

  const banned = [
    [/brave:\/\/|chrome:\/\/extensions|edge:\/\/extensions/i, 'a browser-specific extensions URL'],
    [/ollama pull\s+\S/i, 'an instruction to pull one specific model'],
    [/llama-server\s+-/i, 'a server-specific launch command'],
    [/setup-ollama-cors/i, 'the removed CORS script'],
    [/sudo\s/i, 'a step that needs root'],
  ];
  for (const [re, what] of banned) {
    if (re.test(ctx.readme)) problems.push(`README pins the reader to ${what}`);
  }

  // The shipped default must name no model at all.
  const defaults = path.join(ctx.root, 'src/shared/defaults.js');
  if (fs.existsSync(defaults)) {
    const body = fs.readFileSync(defaults, 'utf8');
    const m = /model:\s*'([^']*)'/.exec(body);
    if (!m) problems.push('src/shared/defaults.js: no model field found');
    else if (m[1] !== '') problems.push(`src/shared/defaults.js hardcodes a default model: ${m[1]}`);
  }
  return problems;
}

const MODES = { images, links, commands, shape, nohardcode, privacy };

/* ----------------------------------------------------------------- selftest */

/** A tree that every mode must reject. Proves the checks are not vacuous. */
function makeBrokenTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-readme-'));
  fs.mkdirSync(path.join(dir, 'docs/images'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(dir, 'README.md'), [
    '# Broken',
    '',
    'Some prose with no action in it at all, going on for a while so that the',
    'first command lands well past the cutoff. Hope this helps.',
    '',
    '#### Too deep',
    '',
    '- one', '- two', '- three', '- four', '- five', '- six',
    '',
    '![shot](images/missing.png)',
    '',
    'Run `npm run nope` and see tools/nonexistent.sh',
    '',
    'Reach it at 192.168.77.13:11434 from /home/someone/projects,',
    'Open brave://extensions, run sudo tools/setup-ollama-cors.sh and ollama pull some:model.',
    'extension id abcdefghijklmnopabcdefghijklmnoq.',
    '',
    ...Array.from({ length: ACTION_WITHIN_LINES }, () => 'filler'),
    '```bash',
    'echo late',
    '```',
  ].join('\n'));
  // A 1x1 PNG: valid magic, but far too small to be a usable screenshot.
  fs.writeFileSync(path.join(dir, 'docs/images/tiny.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));
  return dir;
}

function selftest() {
  const dir = makeBrokenTree();
  const ctx = loadContext(dir);
  const notRejected = [];

  for (const [name, fn] of Object.entries(MODES)) {
    if (fn(ctx).length === 0) notRejected.push(name);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  return notRejected.map((m) => `mode "${m}" passed a deliberately broken tree`);
}

/* --------------------------------------------------------------------- main */

const mode = process.argv[2] ?? 'all';
const run = (name, problems) => {
  if (problems.length) {
    console.error(`check-readme ${name} FAIL`);
    for (const p of problems) console.error(`  ${p}`);
    return false;
  }
  console.log(`check-readme ${name} PASS`);
  return true;
};

let ok;
if (mode === 'selftest') {
  ok = run('selftest', selftest());
} else if (mode === 'all') {
  const ctx = loadContext(REPO);
  ok = Object.entries(MODES).map(([n, f]) => run(n, f(ctx))).every(Boolean);
  ok = run('selftest', selftest()) && ok;
} else if (MODES[mode]) {
  ok = run(mode, MODES[mode](loadContext(REPO)));
} else {
  console.error(`unknown mode "${mode}"`);
  ok = false;
}
process.exit(ok ? 0 : 1);
