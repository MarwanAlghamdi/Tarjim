"""Apply the two patches the extension needs to the vendored PDF.js viewer.

1. viewer.mjs: PDF.js refuses to load a `?file=` whose origin differs from the
   viewer's own origin (`validateFileURL`). Our viewer is served from
   chrome-extension://<id>/, so every real PDF would be rejected. Adding the
   viewer's own origin to HOSTED_VIEWER_ORIGINS restores the behaviour the
   upstream Chromium extension build has. This grants nothing new: the viewer
   is only ever opened by our service worker, for a URL the extension already
   holds a host permission for.

2. viewer.html: content scripts are never injected into an extension's own
   pages, so viewer.html must load the translator scripts itself.

Both patches are idempotent and verified after writing.
"""
import pathlib
import sys

WEB = pathlib.Path("src/pdfjs/web")

# --- 1. viewer.mjs origin guard -------------------------------------------
mjs_path = WEB / "viewer.mjs"
mjs = mjs_path.read_text(encoding="utf-8")

ORIGINAL = (
    'const HOSTED_VIEWER_ORIGINS = new Set(["null", '
    '"http://mozilla.github.io", "https://mozilla.github.io"]);'
)
PATCHED = (
    'const HOSTED_VIEWER_ORIGINS = new Set(["null", '
    '"http://mozilla.github.io", "https://mozilla.github.io", '
    '/* ollama-ar patch: trust our own extension origin */ '
    'URL.parse(window.location)?.origin ?? "null"]);'
)

if PATCHED in mjs:
    print("viewer.mjs: origin guard already patched")
elif ORIGINAL in mjs:
    mjs_path.write_text(mjs.replace(ORIGINAL, PATCHED, 1), encoding="utf-8")
    print("viewer.mjs: patched origin guard")
else:
    sys.exit(
        "ERROR: HOSTED_VIEWER_ORIGINS declaration not found in viewer.mjs.\n"
        "pdf.js changed upstream -- re-check validateFileURL before bumping the version."
    )

# --- 2. viewer.html content-script injection -------------------------------
html_path = WEB / "viewer.html"
html = html_path.read_text(encoding="utf-8")

MARKER = "<!-- ollama-ar translator content scripts -->"
SCRIPTS = (
    f"  {MARKER}\n"
    '  <script src="../../content/ns.js"></script>\n'
    '  <script src="../../content/styles.js"></script>\n'
    '  <script src="../../content/ui.js"></script>\n'
    '  <script src="../../content/main.js"></script>\n'
)

if MARKER in html:
    print("viewer.html: content scripts already injected")
else:
    if "</body>" not in html:
        sys.exit("ERROR: no </body> in viewer.html")
    html_path.write_text(html.replace("</body>", SCRIPTS + "</body>", 1), encoding="utf-8")
    print("viewer.html: injected content scripts")

# --- verify ----------------------------------------------------------------
assert PATCHED in mjs_path.read_text(encoding="utf-8"), "origin patch did not stick"
final_html = html_path.read_text(encoding="utf-8")
for name in ("ns.js", "styles.js", "ui.js", "main.js"):
    assert f"../../content/{name}" in final_html, f"{name} tag missing"
print("verified: both patches present")
