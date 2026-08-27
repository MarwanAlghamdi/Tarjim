#!/usr/bin/env bash
#
# Build the distributable extension.
#
#   tools/package.sh              stage -> verify -> zip -> crx
#   tools/package.sh --no-verify  skip the end-to-end run against the stage
#
# Produces, in dist/:
#   unpacked/          exactly what ships, for "Load unpacked"
#   tarjim-<v>.zip     the same tree zipped -- Web Store upload, or unzip+load
#   tarjim-<v>.crx     signed package, for browsers that still accept a
#                      dragged-in CRX (see README)
#
# The signing key lives at .crx-key.pem in the repo root and is gitignored. It
# is generated on first run and MUST be kept: the extension's ID is derived
# from it, and a new key produces a new ID, which the browser treats as a
# different extension -- losing every saved setting on upgrade.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/unpacked"
KEY="$ROOT/.crx-key.pem"
VERIFY=1

[[ "${1:-}" == "--no-verify" ]] && VERIFY=0

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
ZIP="$DIST/tarjim-$VERSION.zip"
CRX="$DIST/tarjim-$VERSION.crx"

# ---------------------------------------------------------------- stage
rm -rf "$STAGE"
mkdir -p "$STAGE"

cp "$ROOT/manifest.json" "$STAGE/"
# --exclude on the source side, so the stage is the whole extension minus
# things only a debugger reads. Source maps alone are 8.7 MB of the 22 MB tree.
rsync -a --exclude='*.map' "$ROOT/src/" "$STAGE/src/"

# ------------------------------------------------- manifest integrity check
node - "$STAGE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const stage = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));

const referenced = [
  ...Object.values(manifest.icons ?? {}),
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
  // web_accessible_resources are globs; check the directory each one roots at.
  ...(manifest.web_accessible_resources ?? [])
    .flatMap((w) => w.resources ?? [])
    .map((r) => r.replace(/\/\*+$/, '')),
].filter(Boolean);

const missing = referenced.filter((rel) => !fs.existsSync(path.join(stage, rel)));
if (missing.length) {
  console.error('manifest references paths that are not in the package:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(`manifest ok - ${referenced.length} referenced paths present`);
NODE

echo "staged $(du -sh "$STAGE" | cut -f1) in $STAGE"

# ---------------------------------------------------------------- verify
if [[ $VERIFY -eq 1 ]]; then
  echo "running the e2e suite against the staged package..."
  EXTENSION_DIR="$STAGE" npx playwright test --reporter=line
fi

# ---------------------------------------------------------------- zip
# Zipped from INSIDE the stage so manifest.json sits at the archive root,
# which is what both the Web Store and "unzip then Load unpacked" require.
rm -f "$ZIP"
( cd "$STAGE" && zip -qr "$ZIP" . )
echo "zip  $(du -h "$ZIP" | cut -f1)  $ZIP"

# ---------------------------------------------------------------- crx
BROWSER="${CHROME_BIN:-}"
if [[ -z "$BROWSER" ]]; then
  for candidate in \
    "$(node -e 'try{console.log(require("@playwright/test").chromium.executablePath())}catch{}' 2>/dev/null)" \
    "$(command -v google-chrome || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)"
  do
    [[ -n "$candidate" && -x "$candidate" ]] && BROWSER="$candidate" && break
  done
fi

if [[ -z "$BROWSER" ]]; then
  echo "no Chromium binary found - skipping the .crx (set CHROME_BIN to force one)"
  exit 0
fi

KEY_ARG=()
[[ -f "$KEY" ]] && KEY_ARG=(--pack-extension-key="$KEY")

# --pack-extension writes <stage>.crx and, without a key, <stage>.pem.
rm -f "$DIST/unpacked.crx" "$DIST/unpacked.pem"
"$BROWSER" --pack-extension="$STAGE" "${KEY_ARG[@]}" --no-message-box >/dev/null 2>&1 || true

if [[ ! -f "$DIST/unpacked.crx" ]]; then
  echo "packing the .crx failed - the zip above is still good for Load unpacked"
  exit 0
fi

[[ -f "$DIST/unpacked.pem" ]] && mv "$DIST/unpacked.pem" "$KEY" && chmod 600 "$KEY"
mv "$DIST/unpacked.crx" "$CRX"
echo "crx  $(du -h "$CRX" | cut -f1)  $CRX"
echo "key  $KEY  (gitignored - keep it, the extension ID depends on it)"
