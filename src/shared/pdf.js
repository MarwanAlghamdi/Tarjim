/**
 * Decide whether a tab is showing a PDF.
 *
 * The URL is not a reliable signal. arXiv serves
 * https://arxiv.org/pdf/2109.14279 as `Content-Type: application/pdf` with no
 * extension in the path at all, and it is far from alone -- content-addressed
 * and API-served PDFs usually look like that. Keying on ".pdf" meant the
 * "open in the translator viewer" button silently never appeared for them.
 *
 * Asking the document what it is answers exactly, including for Chrome's
 * built-in viewer, which reports `application/pdf` as its contentType.
 */
const PDF_TYPE = 'application/pdf';

/** Cheap fallback for when the document cannot be reached. */
export const PDF_URL = /^(https?|file):\/\/.*\.pdf(\?|#|$)/i;

export function looksLikePdfUrl(url) {
  return PDF_URL.test(url ?? '');
}

/**
 * True when `tabId` is rendering a PDF.
 *
 * Needs activeTab or a host permission, which a toolbar click grants. When the
 * probe cannot run -- a privileged page, or a file:// URL without "Allow
 * access to file URLs" -- it falls back to the extension in the URL rather
 * than reporting a definite "no".
 */
export async function tabIsPdf(tabId, url) {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.contentType,
    });
    if (typeof frame?.result === 'string') {
      return frame.result.toLowerCase().startsWith(PDF_TYPE);
    }
  } catch {
    /* not injectable -- fall through to the URL */
  }
  return looksLikePdfUrl(url);
}
