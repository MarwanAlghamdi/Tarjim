import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from '../../src/shared/chunker.js';

describe('splitIntoChunks', () => {
  it('returns a single chunk for short text', () => {
    expect(splitIntoChunks('Hello world.')).toEqual(['Hello world.']);
  });

  it('returns no chunks for empty or whitespace input', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n\n  ')).toEqual([]);
  });

  it('keeps whole paragraphs together when they fit', () => {
    expect(splitIntoChunks('First para.\n\nSecond para.', 100)).toEqual(['First para.\n\nSecond para.']);
  });

  it('splits on the paragraph boundary when the budget is exceeded', () => {
    const a = 'A'.repeat(60);
    const b = 'B'.repeat(60);
    expect(splitIntoChunks(`${a}\n\n${b}`, 100)).toEqual([a, b]);
  });

  it('falls back to sentence boundaries for an oversized paragraph', () => {
    const text = 'One. Two. Three. Four.';
    const out = splitIntoChunks(text, 12);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(' ')).toBe(text);
  });

  it('hard-splits a single token longer than the budget', () => {
    expect(splitIntoChunks('X'.repeat(250), 100)).toEqual(['X'.repeat(100), 'X'.repeat(100), 'X'.repeat(50)]);
  });

  it('never emits a chunk over the budget', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ');
    for (const c of splitIntoChunks(text, 120)) expect(c.length).toBeLessThanOrEqual(120);
  });
});
