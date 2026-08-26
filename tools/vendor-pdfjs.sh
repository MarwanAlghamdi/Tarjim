#!/usr/bin/env bash
# Vendor the prebuilt Mozilla PDF.js viewer into src/pdfjs/, then apply the two
# patches the extension needs. MV3 forbids remotely-hosted code, so the viewer
# must ship inside the extension and is committed to the repo.
set -euo pipefail

VERSION=6.2.108
URL="https://github.com/mozilla/pdf.js/releases/download/v${VERSION}/pdfjs-${VERSION}-dist.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading pdf.js ${VERSION}..."
curl -fsSL "$URL" -o "$TMP/pdfjs.zip"

rm -rf src/pdfjs
mkdir -p src/pdfjs
unzip -q "$TMP/pdfjs.zip" -d src/pdfjs

test -f src/pdfjs/web/viewer.html || { echo "ERROR: viewer.html missing" >&2; exit 1; }
test -f src/pdfjs/web/viewer.mjs  || { echo "ERROR: viewer.mjs missing"  >&2; exit 1; }
test -f src/pdfjs/build/pdf.worker.mjs || { echo "ERROR: worker missing" >&2; exit 1; }

python3 tools/patch-pdfjs.py
echo "OK — vendored pdf.js ${VERSION} and applied extension patches"
