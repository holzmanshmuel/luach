import { HebrewCalendar, flags } from '@hebcal/core';
import { buildHebrewMonth } from './hebrew-calendar';
import { civilDayFromParts } from './civil-day';
import { civilDayToDate } from './zoned-day';

export interface HolidayInfo {
  /** English name, e.g. "Rosh Hashana" */
  name: string;
  /** Hebrew name, e.g. "ראש השנה" */
  nameHe: string;
  /** True for Yom Tov (no-melacha days) — tinted like Shabbat. */
  yomTov: boolean;
  /**
   * True for a Yom Tov day kept only outside Israel (a diaspora "second day").
   * The first day is universal; these get a "Chutz L'Arets" tag so Israeli family
   * understand they apply abroad, while diaspora family still see them tinted.
   */
  chutzLaaretz: boolean;
}

const stripYear = (s: string) => s.replace(/\s+\d{4}$/, '');

type HebEvent = { getFlags(): number; render(locale: string): string; getDate(): { greg(): Date } };
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * The set of Gregorian dates that are Yom Tov *in Israel* over a range. A diaspora
 * Yom Tov NOT in this set is a "second day" (Chutz L'Arets). NOTE: hebcal's
 * CHUL_ONLY flag can't be used for this — it's set on every diaspora-emitted
 * event (even first days), so we diff the two calendars instead.
 */
function israelYomTovDates(start: Date, end: Date): Set<string> {
  const set = new Set<string>();
  for (const ev of HebrewCalendar.calendar({ start, end, il: true }) as HebEvent[]) {
    if (ev.getFlags() & flags.CHAG) set.add(dateKey(ev.getDate().greg()));
  }
  return set;
}

/** Build a HolidayInfo from a diaspora hebcal event. */
function infoFromEvent(ev: HebEvent, ilYomTov: Set<string>): HolidayInfo {
  const yomTov = Boolean(ev.getFlags() & flags.CHAG);
  // A diaspora Yom Tov that isn't kept in Israel is a second day.
  const chutzLaaretz = yomTov && !ilYomTov.has(dateKey(ev.getDate().greg()));
  let nameHe = stripYear(ev.render('en'));
  try {
    nameHe = stripYear(ev.render('he'));
  } catch {
    /* fall back to English if the Hebrew locale isn't available */
  }
  return { name: stripYear(ev.render('en')), nameHe, yomTov, chutzLaaretz };
}

/** Pick the best holiday entry for a day: prefer Yom Tov, then a universal one. */
function preferred(existing: HolidayInfo | undefined, next: HolidayInfo): HolidayInfo {
  if (!existing) return next;
  if (next.yomTov && !existing.yomTov) return next;
  // Among Yom Tov days, prefer the universal (first-day) entry over a Chutz one.
  if (next.yomTov && existing.yomTov && existing.chutzLaaretz && !next.chutzLaaretz) return next;
  return existing;
}

/**
 * Jewish-calendar holidays for a given Gregorian month, keyed by day-of-month.
 * Uses the DIASPORA schedule (il:false) so second-day Yom Tov is included; those
 * diaspora-only days carry `chutzLaaretz` for a label. First-day Yom Tov is
 * universal. Chol HaMoed, Rosh Chodesh, minor holidays and fasts are surfaced as
 * labels without a tint.
 */
export function getHolidaysForMonth(
  year: number,
  month: number // 0-indexed
): Record<number, HolidayInfo> {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  const ilYomTov = israelYomTovDates(start, end);
  const events = HebrewCalendar.calendar({ start, end, il: false }) as HebEvent[];

  const out: Record<number, HolidayInfo> = {};
  for (const ev of events) {
    const greg = ev.getDate().greg();
    if (greg.getFullYear() !== year || greg.getMonth() !== month) continue;
    const day = greg.getDate();
    out[day] = preferred(out[day], infoFromEvent(ev, ilYomTov));
  }

  return out;
}

/** Holidays keyed by Hebrew day-of-month for a given Hebrew month. */
export function getHolidaysForHebrewMonth(
  hebrewMonth: number,
  hebrewYear: number
): Record<number, HolidayInfo> {
  const model = buildHebrewMonth(hebrewMonth, hebrewYear);
  // The model now carries civil DAYS, not Dates; hebcal still wants real ones, so
  // rehydrate noon carriers (noon exists in every zone on every day, unlike
  // midnight — see zoned-day.ts).
  const start = civilDayToDate(model.days[0].ymd);
  const end = civilDayToDate(model.days[model.days.length - 1].ymd);
  const ilYomTov = israelYomTovDates(start, end);
  const events = HebrewCalendar.calendar({ start, end, il: false }) as HebEvent[];

  // Map each civil day -> hebrew day for this month. Keyed by the YYYY-MM-DD
  // string rather than a midnight getTime(), so a DST transition cannot make two
  // different days hash to the same instant (or a day miss its own key).
  const dayByCivilDay = new Map<string, number>();
  for (const c of model.days) dayByCivilDay.set(c.ymd, c.hebrewDay);

  const out: Record<number, HolidayInfo> = {};
  for (const ev of events) {
    const g = ev.getDate().greg();
    const hd = dayByCivilDay.get(civilDayFromParts(g.getFullYear(), g.getMonth() + 1, g.getDate()));
    if (hd === undefined) continue;
    out[hd] = preferred(out[hd], infoFromEvent(ev, ilYomTov));
  }
  return out;
}
