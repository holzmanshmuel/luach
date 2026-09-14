import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { months } from '@hebcal/core';

/**
 * # What actually crosses from the server into a client component
 *
 * The display bug this file guards was invisible to every other test in the suite,
 * because it was not a wrong conversion — it was a wrong TYPE crossing a process
 * boundary. `CalendarEvent.gregorianDate` was a real `Date`, built on the server
 * at local midnight in `TZ=Asia/Jerusalem`, and handed as a prop to
 * `CalendarGrid` / `HebrewCalendarGrid` / `UpcomingEvents` / `EventDetailModal`.
 * React's wire format keeps the instant, so `.getDate()` in the browser answered
 * in the VIEWER's zone and every relative outside Israel read every birthday,
 * anniversary and yahrzeit one day early.
 *
 * So this does not test another conversion. It walks the objects the real loaders
 * return — against real Postgres, under RLS, as `app_user` — and **fails on any
 * `Date` instance anywhere in them**. A conversion test can be satisfied by a
 * loader that also keeps a Date around; a shape guard cannot.
 *
 * Every person and date below is fictional.
 *
 * Requires DATABASE_URL pointing at a migrated Postgres as `app_user`.
 */

// The loaders resolve the viewer's surname spelling from a cookie. Outside a
// request there is no cookie store, so stand one in — an empty one, i.e. a viewer
// who has never chosen a spelling.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const { systemQuery, query } = await import('@/lib/db');
const { runWithTenant } = await import('@/lib/tenant');
const { deleteFamilies } = await import('@/test-stubs/families');
const {
  getEventsForMonth,
  getEventsForHebrewMonth,
  getUpcomingEvents,
  getGatheringsRaw,
  fetchTimeline,
  dbMonthLabels,
} = await import('@/lib/calendar-data');
const { buildHebrewMonth } = await import('@/lib/hebrew-calendar');
const { isCivilDay } = await import('@/lib/civil-day');
const { todayYmd } = await import('@/lib/zoned-day');
const { hebrewToGregorianAll } = await import('@/lib/hebrew');

let familyId: number;

/** Fictional people, one per shape of date the app has to get right. */
const PEOPLE = [
  // A Hebrew-dated birthday with a stored English date too — expands to TWO
  // occurrences, on different days.
  { name: 'ZzTzElul', type: 'birthday', hDay: 22, hMonth: 'Elul', hYear: 5745, english: '1985-09-08' },
  // A Tevet yahrzeit: the Dec/Jan case, which can fall twice in one civil year.
  { name: 'ZzTzTevet', type: 'yahrtzeit', hDay: 5, hMonth: 'Tevet', hYear: 5778, english: null },
  // A generic-Adar anniversary — recurs in Adar II in a leap year.
  { name: 'ZzTzAdar', type: 'anniversary', hDay: 12, hMonth: 'Adar', hYear: 5770, english: null },
  // 30 Cheshvan, which is clamped onto the 29th in a short Cheshvan year.
  { name: 'ZzTzCheshvan', type: 'birthday', hDay: 30, hMonth: 'Cheshvan', hYear: 5760, english: null },
  // A leap-day English birthday — clamped to Feb 28 in a common year.
  { name: 'ZzTzLeap', type: 'birthday', hDay: 20, hMonth: 'Adar I', hYear: 5748, english: '1988-02-29' },
] as const;

beforeAll(async () => {
  const [fam] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name) VALUES ('Boundary Shape Family') RETURNING id"
  );
  familyId = fam.id;

  await runWithTenant(familyId, async () => {
    for (const p of PEOPLE) {
      const [person] = await query<{ id: number }>(
        'INSERT INTO family_calendar.family_members (name, last_name) VALUES ($1, $2) RETURNING id',
        [p.name, 'Testfamily']
      );
      await query(
        `INSERT INTO family_calendar.events
           (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year, original_english_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [person.id, p.type, p.hDay, p.hMonth, p.hYear, p.english]
      );
    }
    // A gathering on a fixed civil day, to cover the gather_date path too.
    await query(
      `INSERT INTO family_calendar.gatherings (title, kind, gather_date)
       VALUES ('ZzTz Simcha', 'wedding', '2026-12-31')`
    );
  });
});

afterAll(async () => {
  // family_members / events / gatherings FK-cascade off families (migrate-v10).
  await deleteFamilies(familyId);
});

/**
 * Every `Date` instance reachable from `value`, with the path that leads to it.
 * A Date nested inside a tagged family object or a note field is just as fatal as
 * one at the top level, so this walks the whole structure rather than the keys
 * someone remembered to list.
 */
function datesIn(value: unknown, path = '$', seen = new Set<unknown>()): string[] {
  if (value instanceof Date) return [path];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => datesIn(v, `${path}[${i}]`, seen));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    datesIn(v, `${path}.${k}`, seen)
  );
}

describe('no Date crosses into a client component', () => {
  it('getEventsForMonth returns Date-free events for all twelve months', async () => {
    await runWithTenant(familyId, async () => {
      for (let m = 0; m < 12; m++) {
        const events = await getEventsForMonth(2026, m);
        expect(datesIn(events, `month ${m}`)).toEqual([]);
      }
    });
  });

  it('getUpcomingEvents returns Date-free events', async () => {
    await runWithTenant(familyId, async () => {
      const events = await getUpcomingEvents(50);
      expect(events.length).toBeGreaterThan(0);
      expect(datesIn(events, 'upcoming')).toEqual([]);
    });
  });

  it('getEventsForHebrewMonth returns Date-free events, leap year included', async () => {
    await runWithTenant(familyId, async () => {
      // 5787 is a leap year (two Adars); 5786 is not.
      for (const hYear of [5786, 5787]) {
        for (let hMonth = 1; hMonth <= 13; hMonth++) {
          const model = buildHebrewMonth(hMonth, hYear);
          const events = await getEventsForHebrewMonth(dbMonthLabels(hMonth, hYear), hYear, model);
          expect(datesIn(events, `${hYear}/${hMonth}`)).toEqual([]);
          // The MODEL is a client prop too — the grid's "today" ring, its civil-date
          // note and its gathering lookup all read from it.
          expect(datesIn(model, `model ${hYear}/${hMonth}`)).toEqual([]);
        }
      }
    });
  });

  it('gatherings and the timeline are Date-free', async () => {
    await runWithTenant(familyId, async () => {
      const gatherings = await getGatheringsRaw();
      expect(gatherings.length).toBeGreaterThan(0);
      expect(datesIn(gatherings, 'gatherings')).toEqual([]);
      for (const lang of ['en', 'he'] as const) {
        expect(datesIn(await fetchTimeline(lang), `timeline ${lang}`)).toEqual([]);
      }
    });
  });

  it('the walker really would find one (it is not vacuously passing)', () => {
    // A shape guard that cannot fail is not a guard. Prove it sees a Date at the
    // top level, nested, and inside an array.
    expect(datesIn({ gregorianDate: new Date() })).toEqual(['$.gregorianDate']);
    expect(datesIn([{ a: { b: new Date() } }])).toEqual(['$[0].a.b']);
    expect(datesIn({ safe: '2026-09-04', n: 1, nul: null })).toEqual([]);
  });
});

describe('gregorianDay is a well-formed civil day, and the right one', () => {
  it('every occurrence carries a real YYYY-MM-DD day inside the month asked for', async () => {
    await runWithTenant(familyId, async () => {
      for (let m = 0; m < 12; m++) {
        for (const e of await getEventsForMonth(2026, m)) {
          expect(isCivilDay(e.gregorianDay), `${e.name}: ${e.gregorianDay}`).toBe(true);
          expect(e.gregorianDay.slice(0, 7)).toBe(`2026-${String(m + 1).padStart(2, '0')}`);
        }
      }
    });
  });

  it('agrees with hebcal about where the Hebrew occurrences land', async () => {
    // Cross-checked against the recurrence rule rather than against itself: an
    // audit that trusts one source cannot find an error inside that source.
    await runWithTenant(familyId, async () => {
      const all = (await Promise.all(
        Array.from({ length: 12 }, (_, m) => getEventsForMonth(2026, m))
      )).flat();
      for (const p of PEOPLE) {
        const expected = new Set(
          hebrewToGregorianAll(p.hDay, p.hMonth, 2026).map(
            d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          )
        );
        const got = new Set(
          all.filter(e => e.name === p.name && e.dateType === 'hebrew').map(e => e.gregorianDay)
        );
        expect(got, `${p.name} Hebrew occurrences in 2026`).toEqual(expected);
      }
    });
  });

  it('keeps the Tevet yahrzeit\'s BOTH 2026 occurrences when it falls twice', async () => {
    // 5 Tevet can land in early January and again in late December of one civil
    // year. Dropping the second is a regression this repo has already fixed once.
    const twice = hebrewToGregorianAll(5, 'Tevet', 2026);
    expect(twice.length).toBeGreaterThanOrEqual(1);
    await runWithTenant(familyId, async () => {
      const all = (await Promise.all(
        Array.from({ length: 12 }, (_, m) => getEventsForMonth(2026, m))
      )).flat();
      const tevet = all.filter(e => e.name === 'ZzTzTevet');
      expect(tevet).toHaveLength(twice.length);
    });
  });

  it('places the fixed English birthday on its own civil day, clamping Feb 29', async () => {
    await runWithTenant(familyId, async () => {
      // 2026 is not a leap year, so the 29 Feb 1988 birthday is observed on Feb 28.
      const feb = await getEventsForMonth(2026, 1);
      const leap = feb.find(e => e.name === 'ZzTzLeap' && e.dateType === 'gregorian');
      expect(leap?.gregorianDay).toBe('2026-02-28');
      // 2028 IS a leap year — the same row lands on the 29th.
      const feb28 = await getEventsForMonth(2028, 1);
      expect(
        feb28.find(e => e.name === 'ZzTzLeap' && e.dateType === 'gregorian')?.gregorianDay
      ).toBe('2028-02-29');
      // And the September English birthday keeps its own day, not the Hebrew one.
      const sep = await getEventsForMonth(2026, 8);
      expect(
        sep.find(e => e.name === 'ZzTzElul' && e.dateType === 'gregorian')?.gregorianDay
      ).toBe('2026-09-08');
    });
  });

  it('sorts a month by civil day, and never past its own days', async () => {
    await runWithTenant(familyId, async () => {
      for (let m = 0; m < 12; m++) {
        const days = (await getEventsForMonth(2026, m)).map(e => e.gregorianDay);
        expect(days).toEqual([...days].sort());
      }
    });
  });

  it('orders the upcoming list by civil day and never shows a past occurrence', async () => {
    await runWithTenant(familyId, async () => {
      const upcoming = await getUpcomingEvents(50);
      const days = upcoming.map(e => e.gregorianDay);
      expect(days).toEqual([...days].sort());
      const today = todayYmd();
      for (const e of upcoming) {
        expect(e.gregorianDay >= today, `${e.name} on ${e.gregorianDay} is before ${today}`).toBe(true);
        expect(e.daysUntil).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('daysUntil counts calendar days from the deployment\'s today to gregorianDay', async () => {
    // The two must agree: the badge ("in 5 days") and the date it sits next to are
    // read off the same event by the same reader.
    const { civilDaysBetween } = await import('@/lib/civil-day');
    await runWithTenant(familyId, async () => {
      const today = todayYmd();
      for (const e of await getUpcomingEvents(50)) {
        expect(e.daysUntil, `${e.name} on ${e.gregorianDay}`).toBe(
          civilDaysBetween(today, e.gregorianDay)
        );
      }
      for (const e of await getEventsForMonth(2026, 8)) {
        expect(e.daysUntil).toBe(civilDaysBetween(today, e.gregorianDay));
      }
    });
  });

  it('gives the Hebrew grid the civil day of the cell the occurrence sits on', async () => {
    await runWithTenant(familyId, async () => {
      const model = buildHebrewMonth(months.ELUL, 5786);
      const events = await getEventsForHebrewMonth(dbMonthLabels(months.ELUL, 5786), 5786, model);
      expect(events.length).toBeGreaterThan(0);
      const byHebrewDay = new Map(model.days.map(d => [d.hebrewDay, d.ymd]));
      for (const e of events) {
        const cellDay = e.gridDay ?? e.hebrew_day;
        // The occurrence's civil day must be the civil day of its own grid cell —
        // this is what made the detail modal say "Today!" on the wrong day.
        expect(e.gregorianDay, `${e.name} on Hebrew day ${cellDay}`).toBe(byHebrewDay.get(cellDay));
      }
    });
  });
});
