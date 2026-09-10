import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { months } from '@hebcal/core';
import { CalendarGrid } from './CalendarGrid';
import { HebrewCalendarGrid } from './HebrewCalendarGrid';
import { UpcomingEvents } from './UpcomingEvents';
import { EventDetailModal } from './EventDetailModal';
import { MonthNav } from './MonthNav';
import { buildHebrewMonth } from '@/lib/hebrew-calendar';
import type { CalendarEvent } from '@/lib/types';

/**
 * # The server→client boundary, exercised in the reader's timezone
 *
 * This is the test the rest of the suite could not be. Every other calendar test
 * is a pure function, and pure functions were never where the bug lived: it lived
 * at the moment a `Date` built on the server (`TZ=Asia/Jerusalem`, local midnight)
 * was serialised into a client component's props. React's wire format keeps the
 * INSTANT, so `2026-09-04T00:00+03:00` arrived as `2026-09-03T21:00Z` and every
 * `.getDate()` in the browser answered in the VIEWER's zone:
 *
 *     Asia/Jerusalem      -> Fri 4 Sept   (correct)
 *     Europe/London       -> Thu 3 Sept   (wrong)
 *     America/Los_Angeles -> Thu 3 Sept   (wrong)
 *
 * Every relative outside Israel read every birthday, anniversary and yahrzeit one
 * day early. So the assertion here is not "the conversion is right" — it is
 * **"the rendered day does not depend on where the reader is"**, checked by
 * rendering the real components under a spread of viewer zones and diffing the
 * markup. Under the old props these renders differ; under civil-day strings they
 * cannot.
 *
 * `process.env.TZ` really does re-point Node's clock (and `Intl`) mid-process,
 * which is what makes a "viewer in Los Angeles" reproducible here.
 */

// AddEditModal / GatheringModal pull in the server-action module, which is not
// what is under test (and never renders here — the default prefs context has
// canEdit false). Stub them so this file does not depend on that import chain.
vi.mock('./AddEditModal', () => ({ AddEditModal: () => null }));
vi.mock('./GatheringModal', () => ({ GatheringModal: () => null }));

// The real provider needs a Next router. Substitute the prefs a signed-in English
// viewer gets — with the REAL translations, so the assertions below read the copy a
// relative actually sees ("September 3, 2026" inside the candle sentence) rather
// than a bare translation key.
vi.mock('./UserPrefsContext', async () => {
  const { getT } = await import('@/lib/translations');
  return {
    useUserPrefs: () => ({
      language: 'en' as const,
      showNicknames: false,
      isAdmin: false,
      canEdit: false,
      toggleLanguage: () => {},
      toggleNicknames: () => {},
      t: getT('en'),
      branches: [],
      branchVariants: {},
      chosen: {},
      spell: (b?: string | null) => b ?? '',
      setSpelling: () => {},
    }),
  };
});

/** UTC, one zone behind Israel, one far ahead, and one on a half-hour offset. */
const VIEWER_ZONES = [
  'Asia/Jerusalem',      // the deployment's own zone — the reference rendering
  'UTC',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Asia/Kolkata',
];

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

/**
 * Render `fn` once per viewer zone and assert every zone produced byte-identical
 * markup. Returns the reference (Jerusalem) rendering so callers can go on to
 * assert WHAT it says, not just that it agrees.
 */
function renderInEveryZone(fn: () => string): string {
  const byZone = VIEWER_ZONES.map(tz => {
    process.env.TZ = tz;
    return [tz, fn()] as const;
  });
  process.env.TZ = originalTZ;
  const [refZone, reference] = byZone[0];
  for (const [tz, html] of byZone) {
    expect(html, `markup differs in ${tz} vs ${refZone}`).toBe(reference);
  }
  return reference;
}

/** A fictional event on a fixed civil day. Names and dates are invented. */
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    family_member_id: 1,
    event_type: 'birthday',
    event_type_label: null,
    hebrew_day: 22,
    hebrew_month: 'Elul',
    hebrew_year: 5745,
    gregorian_year: 1985,
    original_english_date: '1985-09-04',
    note: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    name: 'Dina',
    last_name: 'Levi',
    name_he: null,
    nickname: null,
    family_branch: null,
    photo_url: null,
    gregorianDay: '2026-09-04',
    hebrewDateDisplay: '22 Elul 5745',
    daysUntil: 3,
    dateType: 'gregorian',
    yearsCount: 41,
    ...overrides,
  };
}

describe('CalendarGrid — the month cell an event lands in', () => {
  const events = [
    event({ id: 1, gregorianDay: '2026-09-04' }),
    event({ id: 2, name: 'Yaakov', event_type: 'yahrtzeit', gregorianDay: '2026-09-01', dateType: 'hebrew' }),
    event({ id: 3, name: 'Rivka', event_type: 'anniversary', gregorianDay: '2026-09-30', dateType: 'hebrew' }),
  ];

  it('renders identically for every viewer timezone', () => {
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <CalendarGrid year={2026} month={8} events={events} todayDay="2026-09-04" />
      )
    );
    // And the days it actually chose are the Jerusalem days, not the day before.
    expect(cellFor(html, 4)).toContain('Dina');
    expect(cellFor(html, 1)).toContain('Yaakov');
    expect(cellFor(html, 30)).toContain('Rivka');
    expect(cellFor(html, 3)).not.toContain('Dina'); // the off-by-one that shipped
  });

  it('rings the DEPLOYMENT\'s today, whatever day it is where the viewer sits', () => {
    // A viewer in Auckland is already on the 5th and one in Los Angeles still on
    // the 3rd; the family's calendar must ring the 4th for all of them.
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <CalendarGrid year={2026} month={8} events={[]} todayDay="2026-09-04" />
      )
    );
    expect(cellFor(html, 4)).toContain('sig-today');
    expect(cellFor(html, 3)).not.toContain('sig-today');
    expect(cellFor(html, 5)).not.toContain('sig-today');
  });

  it('rings nothing when the shown month is not the deployment\'s', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid year={2026} month={9} events={[]} todayDay="2026-09-04" />
    );
    expect(html).not.toContain('sig-today');
  });

  it('lays out the same grid in every viewer timezone across a whole year', () => {
    // Includes the Dec/Jan boundary and both DST months, where a local
    // `new Date(year, month, 1)` can shift the first column.
    for (let m = 0; m < 12; m++) {
      renderInEveryZone(() =>
        renderToStaticMarkup(
          <CalendarGrid year={2026} month={m} events={[]} todayDay="2026-09-04" />
        )
      );
    }
  });

  it('places a Dec-31 and a Jan-1 occurrence on their own days', () => {
    const dec = renderInEveryZone(() =>
      renderToStaticMarkup(
        <CalendarGrid
          year={2026}
          month={11}
          events={[event({ id: 9, name: 'Tevet', gregorianDay: '2026-12-31' })]}
          todayDay="2026-12-31"
        />
      )
    );
    expect(cellFor(dec, 31)).toContain('Tevet');
    expect(cellFor(dec, 30)).not.toContain('Tevet');

    const jan = renderInEveryZone(() =>
      renderToStaticMarkup(
        <CalendarGrid
          year={2027}
          month={0}
          events={[event({ id: 9, name: 'Tevet', gregorianDay: '2027-01-01' })]}
          todayDay="2027-01-01"
        />
      )
    );
    expect(cellFor(jan, 1)).toContain('Tevet');
  });

  it('places an event on each DST-transition day, in every viewer timezone', () => {
    // Israel springs forward 27 Mar 2026 and falls back 25 Oct 2026; the US and NZ
    // move on other dates. A birthday on any of them must not slide a day.
    const cases: [number, number, string][] = [
      [2026, 2, '2026-03-08'],  // US spring forward
      [2026, 2, '2026-03-27'],  // Israel spring forward
      [2026, 9, '2026-10-25'],  // Israel fall back
      [2026, 10, '2026-11-01'], // US fall back
      [2026, 3, '2026-04-05'],  // NZ fall back
      [2026, 8, '2026-09-27'],  // NZ spring forward
    ];
    for (const [year, month, day] of cases) {
      const dom = Number(day.slice(8));
      const html = renderInEveryZone(() =>
        renderToStaticMarkup(
          <CalendarGrid
            year={year}
            month={month}
            events={[event({ id: 7, name: 'Shifra', gregorianDay: day })]}
            todayDay={day}
          />
        )
      );
      expect(cellFor(html, dom), `${day} landed on the wrong cell`).toContain('Shifra');
      expect(cellFor(html, dom), `${day} lost its today ring`).toContain('sig-today');
    }
  });
});

describe('HebrewCalendarGrid — the civil-date note and the today ring', () => {
  const model = buildHebrewMonth(months.ELUL, 5786);
  // 22 Elul 5786 — resolved from the model itself so the fixture cannot drift.
  const elul22 = model.days.find(d => d.hebrewDay === 22)!;

  it('renders identically for every viewer timezone', () => {
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <HebrewCalendarGrid
          model={model}
          events={[event({ hebrew_day: 22, hebrew_month: 'Elul', dateType: 'hebrew', gregorianDay: elul22.ymd })]}
          todayDay={elul22.ymd}
        />
      )
    );
    // The small English note on each cell is the civil day the SERVER resolved.
    expect(html).toContain('Dina');
    expect(html).toContain('sig-today');
    // Every cell's note must be present exactly once, and be that cell's own day.
    for (const d of model.days) {
      const note = new Date(Date.UTC(
        Number(d.ymd.slice(0, 4)), Number(d.ymd.slice(5, 7)) - 1, Number(d.ymd.slice(8)),
      )).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      expect(html).toContain(`>${note}<`);
    }
  });

  it('rings exactly one cell, and it is the deployment\'s day', () => {
    const html = renderToStaticMarkup(
      <HebrewCalendarGrid model={model} events={[]} todayDay={elul22.ymd} />
    );
    expect(html.match(/sig-today/g)).toHaveLength(1);
  });

  it('rings nothing when the deployment\'s day is outside the shown Hebrew month', () => {
    const html = renderToStaticMarkup(
      <HebrewCalendarGrid model={model} events={[]} todayDay="1999-01-01" />
    );
    expect(html).not.toContain('sig-today');
  });

  it('matches a gathering to its cell by civil day, in every viewer timezone', () => {
    const g = {
      id: 1, title: 'Levi wedding', kind: 'wedding' as const,
      gather_date: elul22.ymd, gather_time: null, location: null, description: null,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    };
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <HebrewCalendarGrid model={model} events={[]} gatherings={[g]} todayDay={elul22.ymd} />
      )
    );
    expect(html).toContain('Levi wedding');
  });

  it('spans Adar I and Adar II in a leap year without drifting by zone', () => {
    // 5787 is a leap year: two Adars, the edge case this repo trusts itself on.
    for (const m of [months.ADAR_I, months.ADAR_II, months.CHESHVAN, months.KISLEV, months.TEVET]) {
      const leap = buildHebrewMonth(m, 5787);
      renderInEveryZone(() =>
        renderToStaticMarkup(
          <HebrewCalendarGrid model={leap} events={[]} todayDay={leap.days[0].ymd} />
        )
      );
    }
  });
});

describe('UpcomingEvents — the date badge', () => {
  const events = [
    event({ id: 1, gregorianDay: '2026-09-04', daysUntil: 0 }),
    event({ id: 2, name: 'Yaakov', event_type: 'yahrtzeit', gregorianDay: '2026-12-31', daysUntil: 118, dateType: 'hebrew' }),
    event({ id: 3, name: 'Rivka', event_type: 'anniversary', gregorianDay: '2027-01-01', daysUntil: 119, dateType: 'gregorian' }),
  ];

  it('renders identically for every viewer timezone', () => {
    const html = renderInEveryZone(() => renderToStaticMarkup(<UpcomingEvents events={events} />));
    // The badge must say Sep 4, not Sep 3.
    expect(html).toContain('>Sep</div><div class="text-lg font-bold text-ink leading-tight font-display">4<');
    // 31 Dec vs 1 Jan: two different months, a year apart.
    expect(html).toContain('>Dec</div><div class="text-lg font-bold text-ink leading-tight font-display">31<');
    expect(html).toContain('>Jan</div><div class="text-lg font-bold text-ink leading-tight font-display">1<');
  });

  it('keeps a Jan-1 occurrence in January, not the previous December', () => {
    // The Dec/Jan boundary is where the off-by-one also changed the MONTH label,
    // so an event read one day early jumped a whole month back (and a year).
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <UpcomingEvents events={[event({ id: 5, gregorianDay: '2027-01-01', daysUntil: 119 })]} />
      )
    );
    expect(html).toContain('>Jan<');
    expect(html).not.toContain('>Dec<');
    expect(html).toContain('>1<');
  });
});

describe('EventDetailModal — the falls-on date and the candle eve', () => {
  it('renders identically for every viewer timezone', () => {
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <EventDetailModal
          event={event({ dateType: 'hebrew', gregorianDay: '2026-09-04' })}
          onClose={() => {}}
        />
      )
    );
    expect(html).toContain('September 4, 2026');
    expect(html).not.toContain('September 3, 2026');
  });

  it('puts the yahrzeit candle on the evening BEFORE, counted in civil days', () => {
    const html = renderInEveryZone(() =>
      renderToStaticMarkup(
        <EventDetailModal
          event={event({
            id: 4, name: 'Yaakov', event_type: 'yahrtzeit', dateType: 'hebrew',
            gregorianDay: '2026-09-04', yearsCount: 9,
          })}
          onClose={() => {}}
        />
      )
    );
    // The candle guidance interpolates the eve-before day.
    expect(html).toContain('September 3, 2026');
  });

  it('steps the candle eve back one day across a year boundary and a DST edge', () => {
    const cases: [string, string][] = [
      ['2027-01-01', 'December 31, 2026'],
      ['2026-03-01', 'February 28, 2026'],
      ['2028-03-01', 'February 29, 2028'], // leap year
      ['2026-03-28', 'March 27, 2026'],    // day after Israel springs forward
      ['2026-10-26', 'October 25, 2026'],  // day after Israel falls back
      ['2026-11-02', 'November 1, 2026'],  // day after the US falls back
    ];
    for (const [day, expectedEve] of cases) {
      const html = renderInEveryZone(() =>
        renderToStaticMarkup(
          <EventDetailModal
            event={event({ id: 4, event_type: 'yahrtzeit', dateType: 'hebrew', gregorianDay: day })}
            onClose={() => {}}
          />
        )
      );
      expect(html, `eve-before wrong for ${day}`).toContain(expectedEve);
    }
  });
});

describe('MonthNav', () => {
  it('renders identically for every viewer timezone', () => {
    renderInEveryZone(() =>
      renderToStaticMarkup(<MonthNav year={2026} month={8} todayDay="2026-09-04" />)
    );
  });

  it('hides the "today" shortcut only when the shown month IS the deployment\'s', () => {
    // Decided from the server's day, so a relative in Auckland at 01:00 on the 1st
    // does not get a spurious "back to today" link on the month they are looking at.
    const current = renderToStaticMarkup(<MonthNav year={2026} month={8} todayDay="2026-09-04" />);
    const other = renderToStaticMarkup(<MonthNav year={2026} month={9} todayDay="2026-09-04" />);
    expect(current).not.toContain('>Today<');
    expect(other).toContain('>Today<');
  });

  it('points each month chevron at the edge it renders on, in both directions', () => {
    // Measured from the DOM order plus the container direction, which is how the
    // Hebrew nav's inversion was found: the right-hand button that advanced a
    // month drew a LEFT chevron.
    const ltr = renderToStaticMarkup(<MonthNav year={2026} month={8} todayDay="2026-09-04" />);
    expect(chevronOrder(ltr)).toEqual(['‹', '›']); // ltr row: first child is the LEFT edge

    const model = buildHebrewMonth(months.ELUL, 5786);
    const rtl = renderToStaticMarkup(
      <MonthNav hebrew={{ model, hMonth: months.ELUL, hYear: 5786, isCurrent: true }} />
    );
    expect(rtl).toContain('dir="rtl"');
    // rtl row: the first child is the RIGHT edge, so it must be the RIGHT chevron.
    expect(chevronOrder(rtl)).toEqual(['›', '‹']);
  });

  it('gives the Hebrew nav\'s advance-a-month link the right-pointing chevron', () => {
    const model = buildHebrewMonth(months.ELUL, 5786);
    const rtl = renderToStaticMarkup(
      <MonthNav hebrew={{ model, hMonth: months.ELUL, hYear: 5786, isCurrent: true }} />
    );
    // Pair each link's aria-label with the glyph inside it: "next month" sits on
    // the right of a dir=rtl row, so it must point right.
    const pairs = [...rtl.matchAll(/aria-label="([^"]+)"[^>]*>([‹›])</g)].map(m => [m[1], m[2]]);
    expect(pairs).toContainEqual(['חודש הבא', '›']);  // next month, on the right
    expect(pairs).toContainEqual(['חודש קודם', '‹']); // previous month, on the left
  });
});

describe('the shape that crosses the boundary', () => {
  it('a CalendarEvent carries no Date in any field', () => {
    // The invariant, asserted on the type's own shape: if this ever fails, some
    // loader has started handing a Date to a client component again.
    for (const [key, value] of Object.entries(event())) {
      expect(value instanceof Date, `CalendarEvent.${key} is a Date`).toBe(false);
    }
  });

  it('gregorianDay is a bare YYYY-MM-DD string', () => {
    expect(event().gregorianDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has no Date-taking day formatter left to reach for', async () => {
    // formatGregorianLocalized(date, lang) was the loaded gun: it formatted
    // whatever day the READER's clock said the instant fell on. It is gone, and
    // this pins that nothing reintroduces it.
    const dateFormat = await import('@/lib/date-format');
    expect(Object.keys(dateFormat)).not.toContain('formatGregorianLocalized');
    expect(Object.keys(dateFormat)).toContain('formatCivilDayLocalized');
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

const CELL_WRAPPER = '<div class="min-h-[68px]';

/**
 * The rendered markup of the Gregorian grid cell showing `dayOfMonth` — split on
 * the cell wrapper so each chunk is exactly one cell and a day's chips and its
 * "today" class cannot be read out of a neighbour.
 */
function cellFor(html: string, dayOfMonth: number): string {
  // '>13</div>' does not contain '>3</div>', so the marker is unambiguous.
  const marker = `>${dayOfMonth}</div>`;
  const matches = html.split(CELL_WRAPPER).slice(1).filter(c => c.includes(marker));
  expect(matches, `expected exactly one cell for day ${dayOfMonth}`).toHaveLength(1);
  return matches[0];
}

/** The chevron glyphs in a nav, in DOM order. */
function chevronOrder(html: string): string[] {
  return [...html.matchAll(/[‹›]/g)].map(m => m[0]);
}
