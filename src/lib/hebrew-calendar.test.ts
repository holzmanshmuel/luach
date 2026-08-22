import { describe, it, expect } from 'vitest';
import {
  buildHebrewMonth,
  stepHebrewMonth,
  getHebrewMonthForGregorian,
  heYearLabel,
} from './hebrew-calendar';
import { months } from '@hebcal/core';

describe('buildHebrewMonth — Sivan 5786', () => {
  const m = buildHebrewMonth(months.SIVAN, 5786);

  it('labels the month and year in Hebrew', () => {
    expect(m.monthLabelHe).toBe('סיון');
    expect(m.yearLabelHe).toBe('התשפ״ו');
  });

  it('has 30 days (Sivan is always 30)', () => {
    expect(m.days).toHaveLength(30);
  });

  it('numbers day 25 as כ״ה with its Gregorian date', () => {
    const d25 = m.days[24];
    expect(d25.hebrewDay).toBe(25);
    expect(d25.gematria).toBe('כ״ה');
    expect(d25.gregorian instanceof Date).toBe(true);
  });

  it('renders 15 as ט״ו (not י״ה)', () => {
    expect(m.days[14].gematria).toBe('ט״ו');
  });

  it('leadingBlanks equals the weekday of day 1', () => {
    expect(m.leadingBlanks).toBe(m.days[0].weekday);
  });
});

describe('stepHebrewMonth', () => {
  it('steps Sivan -> Tamuz (same year)', () => {
    expect(stepHebrewMonth(months.SIVAN, 5786, 1)).toEqual({
      hebrewMonth: months.TAMUZ, hebrewYear: 5786,
    });
  });
  it('steps Elul -> Tishrei (year rolls forward)', () => {
    expect(stepHebrewMonth(months.ELUL, 5786, 1)).toEqual({
      hebrewMonth: months.TISHREI, hebrewYear: 5787,
    });
  });
  it('steps Tishrei -> Elul backward (year rolls back)', () => {
    expect(stepHebrewMonth(months.TISHREI, 5787, -1)).toEqual({
      hebrewMonth: months.ELUL, hebrewYear: 5786,
    });
  });
});

describe('getHebrewMonthForGregorian', () => {
  it('maps 2026-06-03 to Sivan 5786', () => {
    const r = getHebrewMonthForGregorian(new Date(2026, 5, 3));
    expect(r).toEqual({ hebrewMonth: months.SIVAN, hebrewYear: 5786 });
  });
});

describe('heYearLabel', () => {
  it('prefixes the 5000s thousands letter ה', () => {
    expect(heYearLabel(5786)).toBe('התשפ״ו');
  });
});
