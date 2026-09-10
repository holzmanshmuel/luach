import { query } from '@/lib/db';
import { hebrewToGregorian, hebrewToGregorianAll, formatHebrewDate, daysUntil, daysUntilCivilDay, getNextOccurrence, yearsSince, yearsSinceForHebrewYear } from '@/lib/hebrew';
import { civilDayParts, civilYear } from '@/lib/civil-day';
import { todayYmd, ymd } from '@/lib/zoned-day';
import { EventWithMember, CalendarEvent, Gathering, FamilyTag } from '@/lib/types';
import { getViewerSpelling, rewriteNames } from '@/lib/spellings';
import { solarDateInYear } from '@/lib/solar';
import { months, type HebrewMonthModel } from '@/lib/hebrew-calendar';
import { HDate } from '@hebcal/core';
import { getT, type Lang } from '@/lib/translations';
import { displayName } from '@/lib/names';
import { formatHebrewDateLocalized, formatCivilDayLocalized } from '@/lib/date-format';

/**
 * The one SELECT list every calendar loader shares — explicit, never `e.*`.
 *
 * Two reasons it is written out:
 *
 *  - **The timestamps come back as ISO TEXT.** `created_at`/`updated_at` are
 *    `timestamptz`, and the pg driver hands those back as JS `Date` objects. These
 *    rows are spread straight into `CalendarEvent`, which is a prop of client
 *    components — so two `Date`s were crossing the server→client boundary behind a
 *    type that declared `string`. Same bug class as `gregorianDate`, just quieter.
 *  - **`family_id` is left out.** It is the tenant column, not part of `Event`, and
 *    a client has no use for it.
 *
 * A new column on `events` that the app displays has to be added here.
 */
const EVENT_COLUMNS = `
  e.id, e.family_member_id, e.event_type, e.event_type_label,
  e.hebrew_day, e.hebrew_month, e.hebrew_year, e.gregorian_year,
  e.original_english_date, e.note,
  to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
`;

/** Same, for the one-off gathering rows the grids and chips render. */
const GATHERING_COLUMNS = `
  id, title, kind,
  to_char(gather_date, 'YYYY-MM-DD') AS gather_date,
  to_char(gather_time, 'HH24:MI') AS gather_time,
  location, description,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
`;

/**
 * The fixed Gregorian birthday (month/day) for a birthday row, so every birthday
 * can appear on both its Hebrew date and its Gregorian date. Prefer the stored
 * English date; otherwise derive the actual solar birth date from the Hebrew date
 * + birth year. Returns null only when neither is available.
 */
function gregorianBirthMonthDay(row: EventWithMember): { month: number; day: number } | null {
  if (row.event_type !== 'birthday') return null;
  if (row.original_english_date) {
    const o = new Date(row.original_english_date + 'T12:00:00Z');
    return { month: o.getUTCMonth(), day: o.getUTCDate() };
  }
  if (row.gregorian_year) {
    const born = hebrewToGregorian(row.hebrew_day, row.hebrew_month, row.gregorian_year);
    if (born) return { month: born.getMonth(), day: born.getDate() };
  }
  return null;
}

/**
 * The solar (month/day) date placed into a specific year, clamped to the intended
 * month. Guards the Feb-29 case: `new Date(y, 1, 29)` overflows to Mar 1 in a
 * non-leap year, which would move a Feb-29 birthday into March — instead it lands
 * on Feb 28.
 */
export async function getEventsForMonth(
  year: number,
  month: number // 0-indexed
): Promise<CalendarEvent[]> {
  const rows = await query<EventWithMember>(`
    SELECT ${EVENT_COLUMNS}, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname, fm.photo_url
    FROM family_calendar.events e
    JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
    ORDER BY fm.name
  `);
  rewriteNames(rows, await getViewerSpelling());

  const events: CalendarEvent[] = [];
  for (const row of rows) {
    // Hebrew occurrence(s) — the recurring Hebrew-calendar date. A Hebrew date can
    // fall twice in one civil year (near the Dec/Jan boundary), so render each.
    for (const gregDate of hebrewToGregorianAll(row.hebrew_day, row.hebrew_month, year)) {
      if (gregDate.getMonth() === month) {
        events.push({
          ...row,
          // The civil day is frozen to a string HERE, on the server, in the
          // deployment's zone. A Date would keep only its instant across the
          // server→client boundary and re-read a day early for any viewer west
          // of Israel — see the note on CalendarEvent.gregorianDay.
          gregorianDay: ymd(gregDate),
          hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
          daysUntil: daysUntil(gregDate),
          dateType: 'hebrew',
          yearsCount: yearsSince(gregDate, row),
        });
      }
    }

    // Gregorian occurrence — every birthday also appears on its fixed solar date
    const md = gregorianBirthMonthDay(row);
    if (md) {
      const fixedDate = solarDateInYear(year, md.month, md.day);
      if (fixedDate.getMonth() === month) {
        events.push({
          ...row,
          gregorianDay: ymd(fixedDate),
          hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
          daysUntil: daysUntil(fixedDate),
          dateType: 'gregorian',
          // The solar occurrence is the English birthday — count in Gregorian years.
          yearsCount: row.gregorian_year ? fixedDate.getFullYear() - row.gregorian_year : null,
        });
      }
    }
  }

  // On the rare day a person's Hebrew and solar occurrence coincide (~once per
  // 19-year cycle), collapse the duplicate so the cell shows one chip, not two.
  const seen = new Set<string>();
  const deduped = events.filter(e => {
    const key = `${e.id}-${e.event_type}-${e.gregorianDay}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // All these days are inside one month, so the YYYY-MM-DD strings sort exactly
  // as the old day-of-month numbers did.
  return deduped.sort((a, b) => (a.gregorianDay < b.gregorianDay ? -1 : a.gregorianDay > b.gregorianDay ? 1 : 0));
}

export async function getUpcomingEvents(limit = 10): Promise<CalendarEvent[]> {
  const rows = await query<EventWithMember>(`
    SELECT ${EVENT_COLUMNS}, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname, fm.photo_url
    FROM family_calendar.events e
    JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
    ORDER BY fm.name
  `);
  rewriteNames(rows, await getViewerSpelling());

  // "Today" is the deployment's civil day, not the process's local midnight.
  const todayKey = todayYmd();
  const thisYear = civilYear(todayKey);

  const upcoming: CalendarEvent[] = [];
  for (const row of rows) {
    // Hebrew occurrence
    const next = getNextOccurrence(row.hebrew_day, row.hebrew_month);
    if (next) {
      upcoming.push({
        ...row,
        gregorianDay: ymd(next.gregorianDate),
        hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
        daysUntil: daysUntil(next.gregorianDate),
        dateType: 'hebrew',
        yearsCount: yearsSinceForHebrewYear(next.hebrewYear, row),
      });
    }

    // Gregorian occurrence — every birthday also appears on its fixed solar date
    const md = gregorianBirthMonthDay(row);
    if (md) {
      // Compared as civil-day STRINGS, so "already past" can't flip on a DST day.
      let candidateDay = ymd(solarDateInYear(thisYear, md.month, md.day));
      if (candidateDay < todayKey) {
        candidateDay = ymd(solarDateInYear(thisYear + 1, md.month, md.day));
      }
      upcoming.push({
        ...row,
        gregorianDay: candidateDay,
        hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
        daysUntil: daysUntilCivilDay(candidateDay),
        dateType: 'gregorian',
        // The solar occurrence is the English birthday — count in Gregorian years.
        yearsCount: row.gregorian_year ? civilYear(candidateDay) - row.gregorian_year : null,
      });
    }
  }

  // A birthday has both a Hebrew and a Gregorian occurrence; keep both when they
  // fall on different days, but drop a true duplicate when they coincide (≈ once
  // per 19-year cycle) so the same line never appears twice.
  const seen = new Set<string>();
  const deduped = upcoming
    .sort((a, b) => (a.gregorianDay < b.gregorianDay ? -1 : a.gregorianDay > b.gregorianDay ? 1 : 0))
    .filter(e => {
      const key = `${e.id}-${e.event_type}-${e.gregorianDay}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return deduped.slice(0, limit);
}

// Map a hebcal month number to the transliterated label(s) stored in events.
const STATIC_HEB_LABEL: Record<number, string> = {
  [months.NISAN]: 'Nisan', [months.IYYAR]: 'Iyyar', [months.SIVAN]: 'Sivan',
  [months.TAMUZ]: 'Tamuz', [months.AV]: 'Av', [months.ELUL]: 'Elul',
  [months.TISHREI]: 'Tishrei', [months.CHESHVAN]: 'Cheshvan', [months.KISLEV]: 'Kislev',
  [months.TEVET]: 'Tevet', [months.SHVAT]: 'Shvat',
};

export function dbMonthLabels(hMonth: number, hYear: number): string[] {
  // In a NON-leap year there is a single Adar (hebcal month ADAR_I). Events may
  // have been stored as 'Adar', 'Adar I', or 'Adar II' (e.g. a leap-year birth),
  // and they all recur in that single Adar — so match every Adar label, else
  // 'Adar I'/'Adar II' rows silently vanish from the Hebrew grid in normal years.
  if (hMonth === months.ADAR_I) {
    return HDate.isLeapYear(hYear) ? ['Adar I'] : ['Adar', 'Adar I', 'Adar II'];
  }
  // Plain-"Adar" events show under Adar II in leap years (common custom).
  if (hMonth === months.ADAR_II) return ['Adar', 'Adar II'];
  return [STATIC_HEB_LABEL[hMonth]];
}

export async function getEventsForHebrewMonth(
  monthLabels: string[],
  hYear: number,
  model: HebrewMonthModel,
): Promise<CalendarEvent[]> {
  const rows = await query<EventWithMember>(`
    SELECT ${EVENT_COLUMNS}, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname, fm.photo_url
    FROM family_calendar.events e
    JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
    ORDER BY fm.name
  `);
  rewriteNames(rows, await getViewerSpelling());

  // Map "M-D" (1-indexed Gregorian) → the model day, so a birthday's fixed solar
  // date can be placed on the Hebrew grid on whatever Hebrew day it lands on.
  const solarDay = new Map<string, HebrewMonthModel['days'][number]>();
  // Map hebrew day-of-month → the model day, so a Hebrew occurrence gets its REAL
  // civil date (not a `new Date()` placeholder, which made the detail modal show a
  // false "Today!", a wrong "falls on" date, and a yahrzeit candle a day early).
  const hebDay = new Map<number, HebrewMonthModel['days'][number]>();
  for (const d of model.days) {
    const parts = civilDayParts(d.ymd);
    solarDay.set(`${parts.month}-${parts.day}`, d);
    hebDay.set(d.hebrewDay, d);
  }
  const lastHebDay = model.days.length ? model.days[model.days.length - 1].hebrewDay : 30;

  const out: CalendarEvent[] = [];
  for (const row of rows) {
    // Hebrew occurrence — placed on the grid by hebrew_day (day-30 clamped onto a
    // short month's last day, matching the grid). Attach that day's real civil date.
    if (monthLabels.includes(row.hebrew_month)) {
      const cell = hebDay.get(Math.min(row.hebrew_day, lastHebDay));
      // No cell means the Hebrew day doesn't exist in this month at all; fall back
      // to the deployment's today, matching the previous `new Date()` placeholder.
      const greg = cell?.ymd ?? todayYmd();
      out.push({
        ...row,
        gregorianDay: greg,
        hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
        daysUntil: cell ? daysUntilCivilDay(greg) : 0,
        dateType: 'hebrew',
        yearsCount: yearsSinceForHebrewYear(hYear, row),
      });
    }

    // Solar (☀) occurrence — a birthday's fixed English date, shown on the Hebrew
    // grid too (it appears in English mode, so it shouldn't vanish in Hebrew mode).
    const md = gregorianBirthMonthDay(row);
    if (md) {
      const cell = solarDay.get(`${md.month + 1}-${md.day}`);
      if (cell) {
        out.push({
          ...row,
          gridDay: cell.hebrewDay, // place it on the Hebrew day the solar date falls on
          gregorianDay: cell.ymd,
          hebrewDateDisplay: formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year),
          daysUntil: daysUntilCivilDay(cell.ymd),
          dateType: 'gregorian',
          yearsCount: row.gregorian_year ? civilYear(cell.ymd) - row.gregorian_year : null,
        });
      }
    }
  }
  return out;
}

export interface TimelineEntry {
  id: number;
  year: number;
  name: string;
  family_branch: string | null;
  photo_url: string | null;
  event_type: string;
  typeLabel: string;
  hebrewDate: string;
  englishDate: string | null;
  ageOrLabel: string | null;
  /** Set ONLY in combined (merged) view — which family this occurrence belongs to. */
  family?: FamilyTag;
}

export async function fetchTimeline(lang: Lang): Promise<TimelineEntry[]> {
  const t = getT(lang);
  const rows = await query<EventWithMember>(`
    SELECT ${EVENT_COLUMNS}, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname, fm.photo_url
    FROM family_calendar.events e
    JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
    WHERE e.gregorian_year IS NOT NULL OR e.original_english_date IS NOT NULL
  `);
  rewriteNames(rows, await getViewerSpelling());

  // The event's year — prefer the stored gregorian_year, otherwise derive it from
  // the original English date (English-only entry stores the full date there and
  // may leave gregorian_year null).
  const eventYear = (row: EventWithMember): number | null =>
    row.gregorian_year ??
    (row.original_english_date ? new Date(row.original_english_date + 'T12:00:00Z').getUTCFullYear() : null);

  // Birth year per person, to compute age-at-event for yahrzeits.
  const birthYearByPerson = new Map<number, number>();
  for (const row of rows) {
    const y = eventYear(row);
    if (row.event_type === 'birthday' && y) birthYearByPerson.set(row.family_member_id, y);
  }

  const entries: TimelineEntry[] = rows.flatMap(row => {
    const year = eventYear(row);
    if (year == null) return [];
    // original_english_date is already a YYYY-MM-DD civil day (db.ts pins the DATE
    // type parser to a string), so format it as one — no Date round-trip.
    const englishDate = row.original_english_date
      ? formatCivilDayLocalized(row.original_english_date, lang)
      : null;

    let ageOrLabel: string | null = null;
    if (row.event_type === 'yahrtzeit') {
      const birthYear = birthYearByPerson.get(row.family_member_id);
      if (birthYear && year > birthYear) {
        ageOrLabel = lang === 'he' ? `גיל ${year - birthYear}` : `age ${year - birthYear}`;
      }
    } else if (row.event_type === 'anniversary') {
      ageOrLabel = lang === 'he' ? 'נישואין' : 'married';
    } else if (row.event_type === 'birthday') {
      ageOrLabel = lang === 'he' ? 'נולד/ה' : 'born';
    }

    return {
      id: row.id,
      year,
      name: displayName(row, lang),
      family_branch: row.family_branch,
      photo_url: row.photo_url,
      event_type: row.event_type,
      typeLabel: row.event_type_label ?? t(`event.${row.event_type}`),
      hebrewDate: formatHebrewDateLocalized(row.hebrew_day, row.hebrew_month, row.hebrew_year, lang),
      englishDate,
      ageOrLabel,
    };
  });

  return entries.sort((a, b) => a.year - b.year);
}

// ── Gatherings (one-off family simchas: weddings, bar/bat mitzvahs, britot, …) ─

export async function getGatheringsRaw(): Promise<Gathering[]> {
  return query<Gathering>(
    `SELECT ${GATHERING_COLUMNS}
     FROM family_calendar.gatherings
     ORDER BY gather_date, gather_time NULLS FIRST`
  );
}
