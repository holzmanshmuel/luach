import { HebrewCalendar, Location, type Event } from '@hebcal/core';
import type { HebrewMonthModel } from './hebrew-calendar';
import { civilDayFromParts } from './civil-day';
import { civilDayToDate } from './zoned-day';

/**
 * Candle-lighting & havdalah times for the calendar.
 *
 * Uses @hebcal/core's astronomical engine with a fixed Location (default
 * Jerusalem). The families table currently has no per-family location column, so
 * every family sees Jerusalem zmanim — the right default for this vault's family
 * and an easy swap later (pass a different Location) if a locale field is added.
 *
 * These are computed on the SERVER only (this module imports @hebcal/core, which
 * must never be bundled into the client) and passed to the calendar grids as plain
 * { candle, havdalah } string maps — mirroring how holidays.ts is threaded through.
 */

// The classic Hebcal Jerusalem city (lat/long, Asia/Jerusalem tz, il=true).
// Location.lookup is guaranteed to resolve this built-in name.
export const JERUSALEM: Location = Location.lookup('Jerusalem')!;

/** A day's Shabbat/Yom Tov edge times — either may be absent on a given day. */
export interface DayZmanim {
  /** Candle-lighting time "HH:MM" (Fri + erev Yom Tov). */
  candle?: string;
  /** Havdalah time "HH:MM" (Motzei Shabbat + Motzei Yom Tov). */
  havdalah?: string;
}

function isCandleLighting(ev: Event): boolean {
  return ev.constructor.name === 'CandleLightingEvent';
}
function isHavdalah(ev: Event): boolean {
  return ev.constructor.name === 'HavdalahEvent';
}

// hebcal TimedEvent carries a preformatted local "HH:MM" in eventTimeStr.
function timeStr(ev: Event): string | undefined {
  const s = (ev as unknown as { eventTimeStr?: string }).eventTimeStr;
  return s && s.length ? s : undefined;
}

/**
 * Candle-lighting / havdalah times for a Gregorian month, keyed by day-of-month
 * (1-indexed), for the English calendar grid. Only days that actually have a
 * candle-lighting or havdalah appear in the map.
 */
export function getZmanimForMonth(
  year: number,
  month: number, // 0-indexed
  location: Location = JERUSALEM,
): Record<number, DayZmanim> {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const events = HebrewCalendar.calendar({
    start,
    end,
    location,
    candlelighting: true,
    il: location.getIsrael(),
  });

  const out: Record<number, DayZmanim> = {};
  for (const ev of events) {
    const greg = ev.getDate().greg();
    if (greg.getFullYear() !== year || greg.getMonth() !== month) continue;
    const t = timeStr(ev);
    if (!t) continue;
    const day = greg.getDate();
    if (isCandleLighting(ev)) (out[day] ??= {}).candle = t;
    else if (isHavdalah(ev)) (out[day] ??= {}).havdalah = t;
  }
  return out;
}

/**
 * Candle-lighting / havdalah times for a Hebrew month, keyed by Hebrew
 * day-of-month, for the Hebrew calendar grid. Maps each timed event's civil date
 * to the model's Hebrew day (same technique as getHolidaysForHebrewMonth).
 */
export function getZmanimForHebrewMonth(
  model: HebrewMonthModel,
  location: Location = JERUSALEM,
): Record<number, DayZmanim> {
  if (!model.days.length) return {};
  // The model carries civil DAYS (strings); hebcal wants Dates, so rehydrate noon
  // carriers — see zoned-day.ts for why noon and not midnight.
  const start = civilDayToDate(model.days[0].ymd);
  const end = civilDayToDate(model.days[model.days.length - 1].ymd);
  const events = HebrewCalendar.calendar({
    start,
    end,
    location,
    candlelighting: true,
    il: location.getIsrael(),
  });

  // Keyed by YYYY-MM-DD rather than a midnight getTime(): a string key cannot be
  // moved by a DST transition.
  const dayByCivilDay = new Map<string, number>();
  for (const c of model.days) dayByCivilDay.set(c.ymd, c.hebrewDay);

  const out: Record<number, DayZmanim> = {};
  for (const ev of events) {
    const g = ev.getDate().greg();
    const hd = dayByCivilDay.get(civilDayFromParts(g.getFullYear(), g.getMonth() + 1, g.getDate()));
    if (hd === undefined) continue;
    const t = timeStr(ev);
    if (!t) continue;
    if (isCandleLighting(ev)) (out[hd] ??= {}).candle = t;
    else if (isHavdalah(ev)) (out[hd] ??= {}).havdalah = t;
  }
  return out;
}
