/**
 * Permission gate for the bundled PDF viewer.
 *
 * Both entry points (the toolbar popup and the context-menu item) navigate the
 * tab here rather than straight to viewer.html.
 *
 * The reason is a Manifest V3 constraint: chrome.permissions.request() needs
 * transient user activation, and activation does NOT survive an `await`. The
 * service worker cannot satisfy that -- it must await tabs.query and
 * permissions.contains before it could ask -- so a request made there always
 * rejects with "This function must be called during a user gesture" and the
 * viewer never opens. An extension PAGE can satisfy it, because the click
 * handler below calls request() as its very first statement.
 *
 * If the origin is already granted this page redirects immediately and the
 * user never sees it.
 */
const VIEWER = 'src/pdfjs/web/viewer.html';

const $ = (id) => document.getElementById(id);

function setStatus(message, kind = '') {
  $('status').textContent = message;
  $('status').className = `status ${kind}`.trim();
}

function viewerUrlFor(src) {
  return chrome.runtime.getURL(VIEWER) + '?file=' + encodeURIComponent(src);
}

(async function init() {
  const src = new URLSearchParams(location.search).get('src');

  if (!src) {
    setStatus('No PDF was specified.', 'error');
    return;
  }
  $('target').textContent = src;

  // Local files are gated by a toggle the user must flip themselves; there is
  // no permission to request.
  if (src.startsWith('file://')) {
    if (await chrome.extension.isAllowedFileSchemeAccess()) {
      location.replace(viewerUrlFor(src));
    } else {
      $('explain').textContent =
        'To open local PDF files, enable "Allow access to file URLs" on this '
        + "extension's Details page, then try again.";
      setStatus('File access is disabled for this extension.', 'error');
    }
    return;
  }

  let origin;
  try {
    origin = `${new URL(src).origin}/*`;
  } catch {
    setStatus('That does not look like a valid address.', 'error');
    return;
  }

  if (await chrome.permissions.contains({ origins: [origin] })) {
    location.replace(viewerUrlFor(src));
    return;
  }

  $('origin').textContent = new URL(src).origin;
  $('ask').hidden = false;
  $('grant').hidden = false;

  $('grant').addEventListener('click', () => {
    // MUST be the first statement: any await here would consume the click's
    // transient activation and the request would reject.
    chrome.permissions.request({ origins: [origin] }).then((granted) => {
      if (granted) {
        location.replace(viewerUrlFor(src));
      } else {
        setStatus('Permission was denied, so the file cannot be read.', 'error');
      }
    }).catch((err) => setStatus(err.message, 'error'));
  });
})();
