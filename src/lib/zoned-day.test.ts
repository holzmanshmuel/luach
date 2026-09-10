import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  addDays,
  civilDayInZone,
  deploymentTimeZone,
  fmtLongDay,
  fmtShortDay,
  isSunday,
  saturdayOfWeek,
  ymd,
} from './zoned-day';

/** A civil-date carrier built the way the callers do. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('deploymentTimeZone', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers TZ, which is what Node uses for local time', () => {
    vi.stubEnv('TZ', 'Asia/Jerusalem');
    expect(deploymentTimeZone()).toBe('Asia/Jerusalem');
  });

  it('always names a zone — a blank TZ never yields an empty string', () => {
    // A blank TZ can leave Node unable to resolve its own zone (resolvedOptions()
    // returns undefined), so the last resort must be a literal.
    vi.stubEnv('TZ', '   ');
    const zone = deploymentTimeZone();
    expect(typeof zone).toBe('string');
    expect(zone.length).toBeGreaterThan(0);
  });

  it('reports the host zone when TZ is absent', () => {
    vi.stubEnv('TZ', undefined);
    expect(deploymentTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('civilDayInZone', () => {
  it('is the calendar date in THAT zone, not in UTC', () => {
    // 21:00Z on Sep 12 2026 is already Sunday Sep 13 in Jerusalem (UTC+3).
    const at = new Date('2026-09-12T21:00:00Z');
    expect(ymd(civilDayInZone(at, 'Asia/Jerusalem'))).toBe('2026-09-13');
    expect(ymd(civilDayInZone(at, 'UTC'))).toBe('2026-09-12');
    // The trap this exists to avoid: the instant's own ISO string says Sep 12.
    expect(at.toISOString().slice(0, 10)).toBe('2026-09-12');
  });

  it('holds the day right up to Jerusalem midnight, then turns over', () => {
    const lastMinute = new Date('2026-09-13T20:59:59Z'); // 23:59:59 Jerusalem
    const firstMinute = new Date('2026-09-13T21:00:00Z'); // 00:00:00 Jerusalem, next day
    expect(ymd(civilDayInZone(lastMinute, 'Asia/Jerusalem'))).toBe('2026-09-13');
    expect(ymd(civilDayInZone(firstMinute, 'Asia/Jerusalem'))).toBe('2026-09-14');
  });

  it('turns the year over in the right place for each zone', () => {
    const at = new Date('2026-12-31T22:30:00Z'); // 01:30 Jan 1 in Jerusalem (UTC+2 in winter)
    expect(ymd(civilDayInZone(at, 'Asia/Jerusalem'))).toBe('2027-01-01');
    expect(ymd(civilDayInZone(at, 'UTC'))).toBe('2026-12-31');
    expect(ymd(civilDayInZone(at, 'America/New_York'))).toBe('2026-12-31');
  });

  it('pins the clock to noon, so a midnight DST shift cannot move the date', () => {
    const d = civilDayInZone(new Date('2026-09-13T09:00:00Z'), 'Asia/Jerusalem');
    expect(d.getHours()).toBe(12);
  });

  it('falls back to the host calendar date on an unusable zone rather than throwing', () => {
    const at = new Date(2026, 8, 13, 9, 0);
    expect(ymd(civilDayInZone(at, 'Not/AZone'))).toBe('2026-09-13');
  });
});

describe('ymd', () => {
  it('reads the local calendar fields', () => {
    expect(ymd(day(2026, 1, 5))).toBe('2026-01-05');
    expect(ymd(day(2026, 12, 31))).toBe('2026-12-31');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(ymd(addDays(day(2026, 9, 30), 1))).toBe('2026-10-01');
    expect(ymd(addDays(day(2026, 12, 27), 6))).toBe('2027-01-02');
    expect(ymd(addDays(day(2027, 1, 1), -1))).toBe('2026-12-31');
  });

  it('keeps the calendar date across a DST change', () => {
    // Israel moved its clocks forward on 2026-03-27.
    expect(ymd(addDays(day(2026, 3, 26), 1))).toBe('2026-03-27');
    expect(ymd(addDays(day(2026, 3, 27), 1))).toBe('2026-03-28');
  });
});

describe('isSunday / saturdayOfWeek', () => {
  it('recognises Sunday only', () => {
    expect(isSunday(day(2026, 9, 13))).toBe(true); // Sunday
    expect(isSunday(day(2026, 9, 14))).toBe(false); // Monday
    expect(isSunday(day(2026, 9, 12))).toBe(false); // Saturday
  });

  it('closes the week on Saturday, from any day in it', () => {
    expect(ymd(saturdayOfWeek(day(2026, 9, 13)))).toBe('2026-09-19'); // Sun -> +6
    expect(ymd(saturdayOfWeek(day(2026, 9, 16)))).toBe('2026-09-19'); // Wed -> Sat
    expect(ymd(saturdayOfWeek(day(2026, 9, 19)))).toBe('2026-09-19'); // Sat -> itself
    expect(ymd(saturdayOfWeek(day(2026, 12, 27)))).toBe('2027-01-02'); // across New Year
  });
});

describe('day labels', () => {
  it('short form matches the weekly digest, long form the reminder', () => {
    expect(fmtShortDay(day(2026, 9, 10))).toBe('Thu, Sep 10');
    expect(fmtLongDay(day(2026, 9, 10))).toBe('Thursday, September 10');
  });
});
