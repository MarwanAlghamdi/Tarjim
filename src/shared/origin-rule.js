/**
 * Strip the Origin header from requests to the configured model server.
 *
 * Chrome omits Origin on a GET from an extension, but always attaches
 * `Origin: chrome-extension://<id>` to a POST. Ollama validates that header
 * against OLLAMA_ORIGINS, whose default allowlist has no extension scheme on
 * it -- so /api/tags succeeded and every translation was refused with 403.
 * That is the whole reason this extension used to ship a sudo script.
 *
 * A declarativeNetRequest rule removes the header instead, which needs no
 * privilege on the user's machine and no daemon restart. The rule is scoped to
 * the one origin the user configured: it cannot affect any other request.
 */
export const ORIGIN_RULE_ID = 1;

/** The DNR rule for one endpoint. Exported so it can be asserted directly. */
export function originRule(endpoint) {
  const { origin } = new URL(endpoint);
  return {
    id: ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'origin', operation: 'remove' }],
    },
    condition: {
      // "|" anchors to the start of the URL, so this matches the configured
      // origin and nothing that merely contains it.
      urlFilter: `|${origin}/`,
      resourceTypes: ['xmlhttprequest'],
    },
  };
}

/**
 * Install the rule for `endpoint`, replacing any previous one.
 *
 * Idempotent and cheap, so callers apply it before acting rather than tracking
 * whether it is current -- an MV3 worker can be torn down at any moment and
 * would lose that state anyway.
 */
export async function applyOriginRule(endpoint) {
  if (!endpoint || !chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [originRule(endpoint)],
    });
  } catch {
    // A malformed endpoint cannot produce a rule; the request will fail later
    // with a message that actually explains the problem.
  }
}
