import { describe, it, expect, afterEach } from 'vitest';
import {
  addCivilDays,
  civilDayFromParts,
  civilDayOfMonth,
  civilDayParts,
  civilDaysBetween,
  civilMonthGrid,
  civilMonthIndex,
  civilWeekday,
  civilYear,
  compareCivilDays,
  isCivilDay,
  isInCivilMonth,
  isWithinCivilDays,
} from './civil-day';

/**
 * The civil-day string type is what a calendar day travels as from the server to
 * the browser, so everything here has to be true **in every timezone** — that is
 * the entire point of the type. Each block therefore re-runs under a spread of
 * viewer zones: UTC, one behind (Los Angeles), one far ahead (Auckland), and one
 * on a half-hour offset (Kolkata), which is where naive `Date`-based arithmetic
 * breaks in a different way again.
 */
const VIEWER_ZONES = ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'];

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

/** Run `fn` once per viewer zone and assert every run agreed. */
function inEveryZone<T>(fn: () => T): T {
  const results = VIEWER_ZONES.map(tz => {
    process.env.TZ = tz;
    return fn();
  });
  for (const [i, r] of results.entries()) {
    expect(r, `differs in ${VIEWER_ZONES[i]}`).toEqual(results[0]);
  }
  process.env.TZ = originalTZ;
  return results[0];
}

describe('isCivilDay', () => {
  it('accepts a real zero-padded day', () => {
    expect(isCivilDay('2026-09-04')).toBe(true);
    expect(isCivilDay('2028-02-29')).toBe(true); // a real leap day
  });
  it('rejects a day that does not exist', () => {
    expect(isCivilDay('2026-02-30')).toBe(false);
    expect(isCivilDay('2027-02-29')).toBe(false); // 2027 is not a leap year
    expect(isCivilDay('2026-13-01')).toBe(false);
    expect(isCivilDay('2026-00-10')).toBe(false);
  });
  it('rejects anything that is not a bare YYYY-MM-DD string', () => {
    expect(isCivilDay('2026-9-4')).toBe(false);
    expect(isCivilDay('2026-09-04T00:00:00Z')).toBe(false);
    expect(isCivilDay(new Date())).toBe(false);
    expect(isCivilDay(undefined)).toBe(false);
    expect(isCivilDay(20260904)).toBe(false);
  });
});

describe('reading a civil day', () => {
  it('splits into parts with a 1-indexed month', () => {
    expect(civilDayParts('2026-09-04')).toEqual({ year: 2026, month: 9, day: 4 });
  });
  it('exposes a 0-indexed month, matching Date#getMonth and the UI keys', () => {
    expect(civilMonthIndex('2026-09-04')).toBe(8);
    expect(civilYear('2026-09-04')).toBe(2026);
    expect(civilDayOfMonth('2026-09-04')).toBe(4);
  });
  it('throws rather than silently returning NaN on a malformed value', () => {
    expect(() => civilDayParts('not-a-day')).toThrow(/civil day/);
  });

  it('reads the same day in every viewer timezone', () => {
    // THE regression. A Date built at local midnight on 4 Sep 2026 in
    // Asia/Jerusalem serialises as 2026-09-03T21:00Z, so .getDate() answered 3 in
    // London, New York and Los Angeles — every birthday a day early. A string
    // has no instant to reinterpret.
    const read = inEveryZone(() => ({
      day: civilDayOfMonth('2026-09-04'),
      month: civilMonthIndex('2026-09-04'),
      year: civilYear('2026-09-04'),
      weekday: civilWeekday('2026-09-04'),
    }));
    expect(read).toEqual({ day: 4, month: 8, year: 2026, weekday: 5 }); // Friday
  });
});

describe('addCivilDays', () => {
  it('steps forward and back', () => {
    expect(addCivilDays('2026-09-04', 1)).toBe('2026-09-05');
    expect(addCivilDays('2026-09-04', -1)).toBe('2026-09-03');
    expect(addCivilDays('2026-09-04', 0)).toBe('2026-09-04');
  });
  it('crosses a month boundary', () => {
    expect(addCivilDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addCivilDays('2026-10-01', -1)).toBe('2026-09-30');
  });
  it('crosses the Dec/Jan year boundary', () => {
    // The boundary that makes a Tevet yahrzeit fall twice in one civil year.
    expect(addCivilDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCivilDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addCivilDays('2026-12-25', 10)).toBe('2027-01-04');
  });
  it('handles leap and non-leap Februaries', () => {
    expect(addCivilDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCivilDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addCivilDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('steps exactly one day across every DST edge, in every viewer zone', () => {
    // Spring-forward and fall-back in each hemisphere, plus Israel's own switches.
    // A local-midnight `setDate()` walk lands on the wrong day (or the same day
    // twice) on these; UTC date-only arithmetic cannot.
    const dstEdges: [string, string][] = [
      ['2026-03-07', '2026-03-08'], // US spring forward
      ['2026-03-08', '2026-03-09'],
      ['2026-11-01', '2026-11-02'], // US fall back
      ['2026-03-26', '2026-03-27'], // Israel spring forward (Fri before last Sun of Mar)
      ['2026-10-24', '2026-10-25'], // Israel fall back
      ['2026-09-26', '2026-09-27'], // NZ spring forward
      ['2026-04-04', '2026-04-05'], // NZ fall back
    ];
    inEveryZone(() => {
      for (const [from, to] of dstEdges) {
        expect(addCivilDays(from, 1)).toBe(to);
        expect(addCivilDays(to, -1)).toBe(from);
        expect(civilDaysBetween(from, to)).toBe(1);
      }
      return null;
    });
  });
});

describe('civilDaysBetween', () => {
  it('counts whole calendar days, signed', () => {
    expect(civilDaysBetween('2026-09-04', '2026-09-11')).toBe(7);
    expect(civilDaysBetween('2026-09-11', '2026-09-04')).toBe(-7);
    expect(civilDaysBetween('2026-09-04', '2026-09-04')).toBe(0);
  });
  it('counts across the year boundary', () => {
    expect(civilDaysBetween('2026-12-28', '2027-01-04')).toBe(7);
  });
  it('counts a whole 7 across a DST transition (never 6.96 rounded down)', () => {
    // The bug in the old (target - today) / 86_400_000 subtraction: an interval
    // containing a clock change is not a whole number of 24-hour days.
    expect(civilDaysBetween('2026-03-05', '2026-03-12')).toBe(7);
    expect(civilDaysBetween('2026-10-29', '2026-11-05')).toBe(7);
  });
  it('agrees in every viewer timezone', () => {
    expect(inEveryZone(() => civilDaysBetween('2026-03-05', '2026-03-12'))).toBe(7);
  });
});

describe('ordering and windows', () => {
  it('compares chronologically', () => {
    expect(compareCivilDays('2026-09-04', '2026-09-05')).toBe(-1);
    expect(compareCivilDays('2026-09-05', '2026-09-04')).toBe(1);
    expect(compareCivilDays('2026-09-04', '2026-09-04')).toBe(0);
    // Zero-padding is what makes plain string `<` correct — a 2-digit month must
    // never sort before a 1-digit one.
    expect(compareCivilDays('2026-09-30', '2026-10-01')).toBe(-1);
    expect(compareCivilDays('2026-12-31', '2027-01-01')).toBe(-1);
  });
  it('sorts a shuffled list the way dates sort', () => {
    const days = ['2027-01-01', '2026-09-30', '2026-12-31', '2026-10-01'];
    expect([...days].sort(compareCivilDays)).toEqual([
      '2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01',
    ]);
  });
  it('treats a window as inclusive of both ends', () => {
    expect(isWithinCivilDays('2026-09-04', '2026-09-04', '2026-09-11')).toBe(true);
    expect(isWithinCivilDays('2026-09-11', '2026-09-04', '2026-09-11')).toBe(true);
    expect(isWithinCivilDays('2026-09-12', '2026-09-04', '2026-09-11')).toBe(false);
    expect(isWithinCivilDays('2026-09-03', '2026-09-04', '2026-09-11')).toBe(false);
  });
  it('places a day in its month', () => {
    expect(isInCivilMonth('2026-09-04', 2026, 8)).toBe(true);
    expect(isInCivilMonth('2026-09-04', 2026, 7)).toBe(false);
    expect(isInCivilMonth('2026-09-04', 2027, 8)).toBe(false);
    // The Dec/Jan trap: December is month 11, not month 0 of the next year.
    expect(isInCivilMonth('2026-12-31', 2026, 11)).toBe(true);
    expect(isInCivilMonth('2027-01-01', 2026, 11)).toBe(false);
  });
});

describe('civilMonthGrid', () => {
  it('gives the weekday of the 1st and the month length', () => {
    expect(civilMonthGrid(2026, 8)).toEqual({ firstWeekday: 2, days: 30 }); // Sep 2026 starts Tue
    expect(civilMonthGrid(2026, 1)).toEqual({ firstWeekday: 0, days: 28 }); // Feb 2026, 28 days
    expect(civilMonthGrid(2028, 1)).toEqual({ firstWeekday: 2, days: 29 }); // Feb 2028, leap
    expect(civilMonthGrid(2026, 11)).toEqual({ firstWeekday: 2, days: 31 }); // Dec 2026
  });
  it('lays the grid out identically in every viewer timezone', () => {
    // `new Date(year, month, 1)` can land on the previous month in a zone that
    // moves its clock at 00:00, which shifts the whole calendar by a column.
    const grids = inEveryZone(() =>
      Array.from({ length: 12 }, (_, m) => civilMonthGrid(2026, m))
    );
    expect(grids).toHaveLength(12);
    expect(grids.map(g => g.days)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });
  it('the 1st of a month has the weekday the grid claims', () => {
    for (let m = 0; m < 12; m++) {
      const { firstWeekday } = civilMonthGrid(2026, m);
      expect(civilWeekday(civilDayFromParts(2026, m + 1, 1))).toBe(firstWeekday);
    }
  });
});

describe('civilDayFromParts', () => {
  it('zero-pads', () => {
    expect(civilDayFromParts(2026, 9, 4)).toBe('2026-09-04');
    expect(civilDayFromParts(2026, 12, 31)).toBe('2026-12-31');
  });
  it('round-trips through civilDayParts', () => {
    for (const day of ['2026-01-01', '2026-09-04', '2028-02-29', '2026-12-31']) {
      const p = civilDayParts(day);
      expect(civilDayFromParts(p.year, p.month, p.day)).toBe(day);
    }
  });
});
