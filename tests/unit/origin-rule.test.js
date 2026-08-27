import { describe, it, expect, vi } from 'vitest';
import { originRule, applyOriginRule, ORIGIN_RULE_ID } from '../../src/shared/origin-rule.js';
import { pickModel } from '../../src/shared/models.js';

describe('originRule', () => {
  it('removes only the Origin header, only for the configured origin', () => {
    const rule = originRule('http://192.168.1.50:8081');

    expect(rule.id).toBe(ORIGIN_RULE_ID);
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.action.requestHeaders).toEqual([{ header: 'origin', operation: 'remove' }]);
    expect(rule.condition.urlFilter).toBe('|http://192.168.1.50:8081/');
    expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
  });

  it('anchors the filter so a lookalike host is not matched', () => {
    // "|" anchors at the start of the URL; without it, an unrelated host that
    // merely contains the endpoint as a substring would also be rewritten.
    expect(originRule('http://localhost:11434').condition.urlFilter.startsWith('|')).toBe(true);
  });

  it('ignores the path and query of the configured endpoint', () => {
    expect(originRule('http://localhost:11434/v1/models?x=1').condition.urlFilter)
      .toBe('|http://localhost:11434/');
  });
});

describe('applyOriginRule', () => {
  it('replaces the previous rule rather than accumulating rules', async () => {
    const updateDynamicRules = vi.fn().mockResolvedValue(undefined);
    chrome.declarativeNetRequest = { updateDynamicRules };

    await applyOriginRule('http://localhost:11434');

    expect(updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [originRule('http://localhost:11434')],
    });
  });

  it('does nothing without an endpoint, and never throws on a bad one', async () => {
    const updateDynamicRules = vi.fn().mockResolvedValue(undefined);
    chrome.declarativeNetRequest = { updateDynamicRules };

    await applyOriginRule('');
    expect(updateDynamicRules).not.toHaveBeenCalled();

    await expect(applyOriginRule('not a url')).resolves.toBeUndefined();
  });
});

describe('pickModel', () => {
  const models = [
    { name: 'embed-only', isEmbedding: true },
    { name: 'thinker:14b', isThinking: true },
    { name: 'plain:12b' },
    { name: 'other:7b' },
  ];

  it('keeps the saved model when the server still has it', () => {
    expect(pickModel(models, 'other:7b')).toBe('other:7b');
  });

  it('ignores a saved model the server no longer has', () => {
    expect(pickModel(models, 'gone:1b')).toBe('plain:12b');
  });

  it('never picks an embedding model, and avoids reasoning models', () => {
    expect(pickModel(models)).toBe('plain:12b');
    expect(pickModel([{ name: 'e', isEmbedding: true }, { name: 't', isThinking: true }])).toBe('t');
  });

  it('returns empty when the server has nothing usable', () => {
    expect(pickModel([{ name: 'e', isEmbedding: true }])).toBe('');
    expect(pickModel([])).toBe('');
    expect(pickModel(undefined)).toBe('');
  });
});
