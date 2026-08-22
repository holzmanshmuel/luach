import { describe, it, expect } from 'vitest';
import { getZmanimForMonth, getZmanimForHebrewMonth, JERUSALEM } from './zmanim';
import { buildHebrewMonth, getHebrewMonthForGregorian } from './hebrew-calendar';

const HHMM = /^\d{2}:\d{2}$/;

describe('getZmanimForMonth (Jerusalem)', () => {
  // July 2026: Fri Jul 24 candle-lighting, Sat Jul 25 havdalah.
  const z = getZmanimForMonth(2026, 6);

  it('has a candle-lighting time on Friday', () => {
    expect(z[24]?.candle).toMatch(HHMM);
  });

  it('has a havdalah time on Saturday', () => {
    expect(z[25]?.havdalah).toMatch(HHMM);
  });

  it('does not put candle-lighting on an ordinary weekday', () => {
    // Tue Jul 21 2026 is a plain weekday — no candle-lighting.
    expect(z[21]?.candle).toBeUndefined();
  });

  it('JERUSALEM location resolves to the Israel schedule', () => {
    expect(JERUSALEM.getIsrael()).toBe(true);
    expect(JERUSALEM.getTzid()).toBe('Asia/Jerusalem');
  });
});

describe('getZmanimForHebrewMonth (Jerusalem)', () => {
  it('returns at least one candle-lighting keyed by Hebrew day', () => {
    const { hebrewMonth, hebrewYear } = getHebrewMonthForGregorian(new Date(2026, 6, 15));
    const model = buildHebrewMonth(hebrewMonth, hebrewYear);
    const z = getZmanimForHebrewMonth(model);
    const candleDays = Object.values(z).filter(d => d.candle).length;
    expect(candleDays).toBeGreaterThan(0);
  });
});
