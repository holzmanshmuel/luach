import { describe, it, expect } from 'vitest';
import { formatHebrewDateLocalized, formatCivilDayLocalized, formatCivilDayShort } from './date-format';

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

describe('formatCivilDayLocalized', () => {
  const d = '2026-06-25'; // 25 June 2026
  it('en -> English long', () => {
    expect(formatCivilDayLocalized(d, 'en')).toBe('June 25, 2026');
  });
  it('he -> Hebrew words', () => {
    expect(formatCivilDayLocalized(d, 'he')).toBe('25 ביוני 2026');
  });

  // The regression this replaced a Date-taking formatter for: the same civil day
  // must render the same sentence no matter what zone the READER is in.
  const ZONES = ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'];
  it('renders identically in every viewer timezone', () => {
    const original = process.env.TZ;
    try {
      const rendered = ZONES.map(tz => {
        process.env.TZ = tz;
        return [formatCivilDayLocalized(d, 'en'), formatCivilDayLocalized(d, 'he'), formatCivilDayShort(d)];
      });
      for (const row of rendered) expect(row).toEqual(rendered[0]);
      expect(rendered[0]).toEqual(['June 25, 2026', '25 ביוני 2026', 'Jun 25']);
    } finally {
      process.env.TZ = original;
    }
  });

  it('is right on the Dec/Jan boundary and on a leap day', () => {
    expect(formatCivilDayLocalized('2026-12-31', 'en')).toBe('December 31, 2026');
    expect(formatCivilDayLocalized('2027-01-01', 'en')).toBe('January 1, 2027');
    expect(formatCivilDayLocalized('2028-02-29', 'en')).toBe('February 29, 2028');
    expect(formatCivilDayShort('2026-12-31')).toBe('Dec 31');
  });
});
