import { describe, it, expect } from 'vitest';
import { HDate, months, HebrewCalendar } from '@hebcal/core';
import {
  hebrewToGregorian,
  hebrewToGregorianAll,
  exactGregorianToHebrew,
  gregorianToHebrew,
  getNextOccurrence,
} from './hebrew';

// Format using LOCAL date components (the app reads .getMonth()/.getDate()
// locally; toISOString() would shift by the timezone offset and lie).
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date | null) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
const refGreg = (day: number, monthNum: number, hYear: number) =>
  fmt(new HDate(day, monthNum, hYear).greg());
const hebMonthOf = (d: Date | null) => (d ? new HDate(d).getMonth() : null);

describe('hebrewToGregorian — Adar in leap vs non-leap years (H3)', () => {
  it('places a generic-Adar occasion in Adar II in a leap year (matches @hebcal)', () => {
    const got = hebrewToGregorian(15, 'Adar', 2024); // 2024 ⊂ leap 5784
    expect(hebMonthOf(got)).toBe(months.ADAR_II);
    expect(fmt(got)).toBe(refGreg(15, months.ADAR_II, 5784));
    // Authoritative cross-check: a non-leap-Adar birth recurs via getBirthdayOrAnniversary.
    const anniv = HebrewCalendar.getBirthdayOrAnniversary(5784, new HDate(15, months.ADAR_I, 5783))!;
    expect(fmt(got)).toBe(fmt(anniv.greg()));
  });

  it('places a generic-Adar occasion in the single Adar in a non-leap year', () => {
    const got = hebrewToGregorian(15, 'Adar', 2025); // 2025 ⊂ non-leap 5785
    expect(hebMonthOf(got)).toBe(months.ADAR_I); // month 12 = the only Adar
    expect(fmt(got)).toBe(refGreg(15, months.ADAR_I, 5785));
  });

  it('honours an explicit Adar I and Adar II in a leap year', () => {
    expect(hebMonthOf(hebrewToGregorian(15, 'Adar I', 2024))).toBe(months.ADAR_I);
    expect(hebMonthOf(hebrewToGregorian(15, 'Adar II', 2024))).toBe(months.ADAR_II);
  });

  it('collapses Adar I and Adar II to the single Adar in a non-leap year', () => {
    expect(fmt(hebrewToGregorian(15, 'Adar I', 2025))).toBe(refGreg(15, months.ADAR_I, 5785));
    expect(fmt(hebrewToGregorian(15, 'Adar II', 2025))).toBe(refGreg(15, months.ADAR_I, 5785));
  });
});

describe('hebrewToGregorian — 30 Cheshvan / 30 Kislev short months (H4)', () => {
  it('clamps 30 Cheshvan to the 29th in a short-Cheshvan year instead of rolling to Kislev', () => {
    // Cheshvan 5786 has 29 days. Old code silently returned 1 Kislev.
    const got = hebrewToGregorian(30, 'Cheshvan', 2025);
    expect(hebMonthOf(got)).toBe(months.CHESHVAN); // NOT Kislev
    expect(new HDate(got!).getDate()).toBe(29);
    // Matches @hebcal's getYahrzeit roll-back rule.
    const yz = HebrewCalendar.getYahrzeit(5786, new HDate(30, months.CHESHVAN, 5785))!;
    expect(fmt(got)).toBe(fmt(yz.greg()));
  });

  it('keeps 30 Cheshvan on the 30th in a long-Cheshvan year', () => {
    const got = hebrewToGregorian(30, 'Cheshvan', 2024); // Cheshvan 5785 has 30 days
    expect(hebMonthOf(got)).toBe(months.CHESHVAN);
    expect(new HDate(got!).getDate()).toBe(30);
  });

  it('never lands a 30-Cheshvan event in the wrong Hebrew month (no silent overflow)', () => {
    for (let gy = 2020; gy <= 2035; gy++) {
      const d = hebrewToGregorian(30, 'Cheshvan', gy);
      if (d) expect(new HDate(d).getMonth()).toBe(months.CHESHVAN);
    }
  });
});

describe('hebrewToGregorianAll — Dec/Jan double occurrence (H2)', () => {
  it('returns BOTH the January and December occurrences of an early-Tevet date in one civil year', () => {
    // 5 Tevet falls on 2025-01-05 (Tevet 5785) AND 2025-12-25 (Tevet 5786).
    const all = hebrewToGregorianAll(5, 'Tevet', 2025);
    expect(all.length).toBe(2);
    for (const d of all) {
      expect(d.getFullYear()).toBe(2025);
      const h = new HDate(d);
      expect([h.getMonth(), h.getDate()]).toEqual([months.TEVET, 5]);
    }
    const civilMonths = all.map(d => d.getMonth()).sort((a, b) => a - b);
    expect(civilMonths).toEqual([0, 11]); // January and December
  });

  it('single-value hebrewToGregorian still returns the first (January) occurrence', () => {
    expect(hebrewToGregorian(5, 'Tevet', 2025)!.getMonth()).toBe(0);
  });

  it('most dates occur exactly once in a civil year', () => {
    expect(hebrewToGregorianAll(15, 'Nisan', 2025).length).toBe(1);
    expect(hebrewToGregorianAll(15, 'Av', 2025).length).toBe(1);
  });
});

describe('exactGregorianToHebrew — stores the correct Adar name (H3 root cause)', () => {
  it('stores a non-leap Adar date as generic "Adar", not "Adar I"', () => {
    // Build a known non-leap Adar civil date from hebcal itself (TZ-safe).
    const d = new HDate(14, months.ADAR_I, 5783).greg(); // non-leap 5783
    const got = exactGregorianToHebrew(d.getMonth() + 1, d.getDate(), d.getFullYear());
    expect(got).toMatchObject({ day: 14, month: 'Adar' });
  });

  it('distinguishes Adar I and Adar II in a leap year', () => {
    const d1 = new HDate(15, months.ADAR_I, 5784).greg();
    const d2 = new HDate(15, months.ADAR_II, 5784).greg();
    expect(exactGregorianToHebrew(d1.getMonth() + 1, d1.getDate(), d1.getFullYear())?.month).toBe('Adar I');
    expect(exactGregorianToHebrew(d2.getMonth() + 1, d2.getDate(), d2.getFullYear())?.month).toBe('Adar II');
  });

  it('round-trips ordinary dates back to the same Gregorian day', () => {
    for (const [m, d, y] of [[5, 14, 1990], [11, 2, 2001], [7, 30, 2015]] as const) {
      const h = exactGregorianToHebrew(m, d, y)!;
      expect(fmt(hebrewToGregorian(h.day, h.month, y))).toBe(fmt(new Date(y, m - 1, d)));
    }
  });
});

describe('gregorianToHebrew — month naming', () => {
  it('names the single Adar "Adar" in a non-leap year', () => {
    const d = new HDate(15, months.ADAR_I, 5785).greg(); // non-leap
    expect(gregorianToHebrew(d).month).toBe('Adar');
  });
  it('names leap-year Adars "Adar I" / "Adar II"', () => {
    expect(gregorianToHebrew(new HDate(15, months.ADAR_I, 5784).greg()).month).toBe('Adar I');
    expect(gregorianToHebrew(new HDate(15, months.ADAR_II, 5784).greg()).month).toBe('Adar II');
  });
});

describe('getNextOccurrence — Hebrew year derivation (L1)', () => {
  it('reports a Hebrew year consistent with the returned Gregorian date', () => {
    // Tevet falls in Jan; the old fixed-offset code mis-derived its Hebrew year.
    const r = getNextOccurrence(10, 'Tevet');
    expect(r).not.toBeNull();
    if (r) expect(r.hebrewYear).toBe(new HDate(r.gregorianDate).getFullYear());
  });
});
