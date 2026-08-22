import { describe, it, expect } from 'vitest';
import { formatHebrewDateLocalized, formatGregorianLocalized } from './date-format';

describe('formatHebrewDateLocalized', () => {
  it('en -> transliterated', () => {
    expect(formatHebrewDateLocalized(25, 'Sivan', 5786, 'en')).toBe('25 Sivan 5786');
  });
  it('he -> gematria with year', () => {
    expect(formatHebrewDateLocalized(25, 'Sivan', 5786, 'he')).toBe('כ״ה סיון התשפ״ו');
  });
  it('he without year', () => {
    expect(formatHebrewDateLocalized(25, 'Sivan', null, 'he')).toBe('כ״ה סיון');
  });
});

describe('formatGregorianLocalized', () => {
  const d = new Date(2026, 5, 25); // 25 June 2026
  it('en -> English long', () => {
    expect(formatGregorianLocalized(d, 'en')).toBe('June 25, 2026');
  });
  it('he -> Hebrew words', () => {
    expect(formatGregorianLocalized(d, 'he')).toBe('25 ביוני 2026');
  });
});
