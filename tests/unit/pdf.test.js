import { describe, it, expect, vi } from 'vitest';
import { looksLikePdfUrl, tabIsPdf } from '../../src/shared/pdf.js';

describe('looksLikePdfUrl', () => {
  it('matches a plain .pdf path, with a query or fragment', () => {
    expect(looksLikePdfUrl('https://example.com/paper.pdf')).toBe(true);
    expect(looksLikePdfUrl('https://example.com/paper.pdf?v=2')).toBe(true);
    expect(looksLikePdfUrl('file:///home/x/paper.pdf#page=3')).toBe(true);
  });

  it('does NOT match a PDF served without an extension', () => {
    // The reported defect: this is a real PDF, and the URL cannot tell you.
    expect(looksLikePdfUrl('https://arxiv.org/pdf/2109.14279')).toBe(false);
  });

  it('ignores non-web schemes and empty input', () => {
    expect(looksLikePdfUrl('chrome://settings')).toBe(false);
    expect(looksLikePdfUrl('')).toBe(false);
    expect(looksLikePdfUrl(undefined)).toBe(false);
  });
});

describe('tabIsPdf', () => {
  const withContentType = (type) => {
    chrome.scripting.executeScript = vi.fn(async () => [{ result: type }]);
  };

  it('trusts the document over the URL', async () => {
    withContentType('application/pdf');
    expect(await tabIsPdf(1, 'https://arxiv.org/pdf/2109.14279')).toBe(true);
  });

  it('rejects a page that merely has .pdf in its URL but renders HTML', async () => {
    withContentType('text/html');
    expect(await tabIsPdf(1, 'https://example.com/about-our.pdf')).toBe(false);
  });

  it('tolerates a charset parameter on the content type', async () => {
    withContentType('Application/PDF; charset=binary');
    expect(await tabIsPdf(1, 'https://example.com/x')).toBe(true);
  });

  it('falls back to the URL when the tab cannot be probed', async () => {
    chrome.scripting.executeScript = vi.fn(async () => { throw new Error('Cannot access contents'); });

    expect(await tabIsPdf(1, 'https://example.com/paper.pdf')).toBe(true);
    expect(await tabIsPdf(1, 'https://example.com/page')).toBe(false);
  });
});
