import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PORT_NAME, MSG } from '../../src/shared/protocol.js';

const nsSource = readFileSync(new URL('../../src/content/ns.js', import.meta.url), 'utf8');

describe('content-script protocol constants stay in sync with shared/protocol.js', () => {
  it('declares the same port name', () => {
    expect(nsSource).toContain(`'${PORT_NAME}'`);
  });

  it('declares every message type with the same literal value', () => {
    for (const [key, value] of Object.entries(MSG)) {
      expect(nsSource, `MSG.${key}`).toContain(`${key}: '${value}'`);
    }
  });
});
