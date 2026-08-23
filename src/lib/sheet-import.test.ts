import { describe, it, expect, afterEach } from 'vitest';
import { HEBREW_MONTHS } from 'parse-hebrew-date';
import {
  parseEnglishDate,
  splitAnniversaryCell,
  toAppMonth,
  UnmappedHebrewMonthError,
} from './sheet-import';
import { hebrewToGregorianAll } from './hebrew';

// Node re-reads process.env.TZ on the next Date operation, so an importer run on
// a Jerusalem laptop can be reproduced here rather than argued about.
const ORIGINAL_TZ = process.env.TZ;

function inTimezone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// A spread of offsets on both sides of Greenwich, using zones whose 1961 and
// 1971 offsets are the stable ones (Kiritimati, for instance, was UTC-10:40
// back then and only jumped to +14 in 1995).
const TIMEZONES = [
  'UTC',
  'Asia/Jerusalem', // +2 — where this app's own 38 dates were lost
  'Asia/Tokyo', // +9
  'Pacific/Auckland', // +12
  'America/New_York', // -5
  'America/Los_Angeles', // -8
];

describe('parseEnglishDate keeps the calendar date on every host timezone', () => {
  it.each(TIMEZONES)('"February 8, 1961" is 1961-02-08 in %s', tz => {
    expect(inTimezone(tz, () => parseEnglishDate('February 8, 1961'))).toBe('1961-02-08');
  });

  it.each(TIMEZONES)('"Aug. 3, 1971" is 1971-08-03 in %s', tz => {
    expect(inTimezone(tz, () => parseEnglishDate('Aug. 3, 1971'))).toBe('1971-08-03');
  });

  // An already-ISO cell is the mirror-image hazard: `new Date('1961-02-08')` is
  // UTC midnight, so reading local fields off it loses a day WEST of Greenwich.
  it.each(TIMEZONES)('an ISO cell "1961-02-08" survives %s', tz => {
    expect(inTimezone(tz, () => parseEnglishDate('1961-02-08'))).toBe('1961-02-08');
  });

  it.each(TIMEZONES)('the first of a month does not roll back a month in %s', tz => {
    expect(inTimezone(tz, () => parseEnglishDate('March 1, 1990'))).toBe('1990-03-01');
  });

  it.each(TIMEZONES)('a Jan 1 does not roll back a year in %s', tz => {
    expect(inTimezone(tz, () => parseEnglishDate('January 1, 2000'))).toBe('2000-01-01');
  });

  // Proves the tests above are not passing vacuously: the shipped-then-fixed
  // implementation really does give the wrong answer on a Jerusalem host.
  it('the old toISOString() approach is genuinely wrong here', () => {
    const naive = inTimezone('Asia/Jerusalem', () =>
      new Date('February 8, 1961').toISOString().split('T')[0]
    );
    expect(naive).toBe('1961-02-07'); // the production bug: one day early
    expect(inTimezone('Asia/Jerusalem', () => parseEnglishDate('February 8, 1961'))).not.toBe(naive);
  });
});

describe('parseEnglishDate on cells that are not dates', () => {
  it.each([['', null], ['   ', null], ['not a date', null], ['2020-13-45', null]] as const)(
    '%j -> %j',
    (input, expected) => {
      expect(parseEnglishDate(input)).toBe(expected);
    }
  );

  it('handles a missing cell', () => {
    expect(parseEnglishDate(undefined)).toBeNull();
    expect(parseEnglishDate(null)).toBeNull();
  });
});

describe('month vocabulary', () => {
  it('maps every month parse-hebrew-date can produce', () => {
    for (const month of HEBREW_MONTHS) {
      expect(() => toAppMonth(month)).not.toThrow();
    }
  });

  it('maps every one of them to a month the calendar can actually resolve', () => {
    // The real contract: hebrew.ts must turn the stored string into a date. A
    // month it does not recognise resolves to nothing and the person silently
    // never appears on the calendar.
    for (const month of HEBREW_MONTHS) {
      expect(hebrewToGregorianAll(1, toAppMonth(month), 2025).length).toBeGreaterThan(0);
    }
  });

  it('covers the whole package list, not a subset', () => {
    expect(HEBREW_MONTHS).toHaveLength(14);
  });

  it('throws loudly on a month it does not know', () => {
    // The plausible failure: a future package release renames a month.
    expect(() => toAppMonth('Iyar')).toThrow(/Unmapped Hebrew month/);
    expect(() => toAppMonth('Marcheshvan')).toThrow(/Unmapped Hebrew month/);
    expect(() => toAppMonth('')).toThrow(/Unmapped Hebrew month/);
  });

  it('throws a distinguishable error, so the importer can abort on it', () => {
    // The importer swallows an unreadable cell as a row warning but must NOT
    // swallow this one — it means every row with that month is being mis-filed.
    expect(() => toAppMonth('Iyar')).toThrow(UnmappedHebrewMonthError);
    try {
      toAppMonth('Iyar');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnmappedHebrewMonthError);
      expect((err as UnmappedHebrewMonthError).month).toBe('Iyar');
    }
  });
});

describe('splitAnniversaryCell', () => {
  it('finds the Hebrew half written first', () => {
    expect(splitAnniversaryCell("ח' שבט ~ January 23")).toEqual({
      hebrew: "ח' שבט",
      english: 'January 23',
    });
  });

  it('finds the Hebrew half written second', () => {
    expect(splitAnniversaryCell("January 23 ~ ח' שבט")).toEqual({
      hebrew: "ח' שבט",
      english: 'January 23',
    });
  });

  it('survives the backslash-escaped separator CSV exports leave behind', () => {
    expect(splitAnniversaryCell("ח' שבט \\~ January 23")).toEqual({
      hebrew: "ח' שבט",
      english: 'January 23',
    });
  });

  it('handles a Hebrew-only cell', () => {
    expect(splitAnniversaryCell('Chof Gimmel Shvat')).toEqual({
      hebrew: 'Chof Gimmel Shvat',
      english: null,
    });
  });

  it('reports no Hebrew half when there is none', () => {
    expect(splitAnniversaryCell('January 23')).toEqual({ hebrew: null, english: null });
  });

  it('treats a blank cell as empty', () => {
    expect(splitAnniversaryCell('')).toEqual({ hebrew: null, english: null });
    expect(splitAnniversaryCell(undefined)).toEqual({ hebrew: null, english: null });
  });
});
