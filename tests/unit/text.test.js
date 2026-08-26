import { describe, it, expect } from 'vitest';
import { stripThinkBlocks, isArabicOnly, sanitizeTranslation } from '../../src/shared/text.js';

describe('stripThinkBlocks', () => {
  it('removes a complete think block', () => {
    expect(stripThinkBlocks('<think>reasoning here</think>الطقس جميل')).toBe('الطقس جميل');
  });

  it('removes an unterminated think block (stream truncated mid-reasoning)', () => {
    expect(stripThinkBlocks('<think>still reasoning and never closed')).toBe('');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripThinkBlocks('الطقس جميل')).toBe('الطقس جميل');
  });
});

describe('isArabicOnly', () => {
  it('is true for pure Arabic with punctuation and digits', () => {
    expect(isArabicOnly('السلام عليكم ورحمة الله وبركاته.')).toBe(true);
    expect(isArabicOnly('الفصل ٣: المقدمة (٢٠٢٤)')).toBe(true);
  });

  it('is false when Latin letters are present', () => {
    expect(isArabicOnly('The report said مرحبا بكم')).toBe(false);
  });

  it('is false for text with no Arabic letters at all', () => {
    expect(isArabicOnly('Hello world')).toBe(false);
    expect(isArabicOnly('12345 !!!')).toBe(false);
  });

  it('is false for other non-Latin scripts', () => {
    expect(isArabicOnly('今天的天气非常好')).toBe(false);
  });
});

describe('sanitizeTranslation', () => {
  it('trims the leading/trailing whitespace every model returns', () => {
    expect(sanitizeTranslation(' مرحبًا، كيف حالك اليوم؟ ')).toBe('مرحبًا، كيف حالك اليوم؟');
  });

  it('strips a leaked English preamble', () => {
    expect(sanitizeTranslation('Here is the translation: الطقس جميل')).toBe('الطقس جميل');
    expect(sanitizeTranslation('Translation:\nالطقس جميل')).toBe('الطقس جميل');
  });

  it('strips wrapping quotation marks', () => {
    expect(sanitizeTranslation('"الطقس جميل"')).toBe('الطقس جميل');
    expect(sanitizeTranslation('«الطقس جميل»')).toBe('الطقس جميل');
  });

  it('strips think blocks as well', () => {
    expect(sanitizeTranslation('<think>hmm</think>\n الطقس جميل ')).toBe('الطقس جميل');
  });

  it('preserves interior line breaks', () => {
    expect(sanitizeTranslation(' السطر الأول.\nالسطر الثاني.\n\nفقرة جديدة. '))
      .toBe('السطر الأول.\nالسطر الثاني.\n\nفقرة جديدة.');
  });

  it('does not strip a quote that is only on one side', () => {
    expect(sanitizeTranslation('قال "مرحبا')).toBe('قال "مرحبا');
  });
});
