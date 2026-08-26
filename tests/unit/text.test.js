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

  it('is false for other languages written in the Arabic script', () => {
    // Persian, Urdu and Pashto live in the same Unicode block as Arabic. If
    // these are treated as Arabic they get passed through untranslated, which
    // silently defeats the whole point of the extension.
    expect(isArabicOnly('امروز هوا بسیار خوب است و ما تصمیم گرفتیم به پارک برویم')).toBe(false);
    expect(isArabicOnly('آج موسم بہت اچھا ہے اور ہم نے پارک جانے کا فیصلہ کیا')).toBe(false);
    expect(isArabicOnly('نن ورځ هوا ډېره ښه ده')).toBe(false);
  });

  it('is false for a single Persian-only letter among Arabic text', () => {
    expect(isArabicOnly('هذا نص عربي گ')).toBe(false);
  });

  it('is true for Arabic with harakat, tatweel and ligatures', () => {
    expect(isArabicOnly('وَافَقَتِ اللَّجْنَةُ عَلَى الاقْتِرَاحِ')).toBe(true);
    expect(isArabicOnly('الحمد لله رب العالمين ﷻ')).toBe(true);
    expect(isArabicOnly('مرحبـــا بكم')).toBe(true);
  });

  it('is true for Arabic containing Western punctuation and numerals', () => {
    expect(isArabicOnly('الفصل 3: المقدمة (2024) — نظرة عامة.')).toBe(true);
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
