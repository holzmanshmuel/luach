import { HebrewCalendar, Location, type Event } from '@hebcal/core';
import type { HebrewMonthModel } from './hebrew-calendar';

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
  const start = model.days[0].gregorian;
  const end = model.days[model.days.length - 1].gregorian;
  const events = HebrewCalendar.calendar({
    start,
    end,
    location,
    candlelighting: true,
    il: location.getIsrael(),
  });

  const dayByTime = new Map<number, number>();
  for (const c of model.days) {
    const k = new Date(
      c.gregorian.getFullYear(),
      c.gregorian.getMonth(),
      c.gregorian.getDate(),
    ).getTime();
    dayByTime.set(k, c.hebrewDay);
  }

  const out: Record<number, DayZmanim> = {};
  for (const ev of events) {
    const g = ev.getDate().greg();
    const k = new Date(g.getFullYear(), g.getMonth(), g.getDate()).getTime();
    const hd = dayByTime.get(k);
    if (hd === undefined) continue;
    const t = timeStr(ev);
    if (!t) continue;
    if (isCandleLighting(ev)) (out[hd] ??= {}).candle = t;
    else if (isHavdalah(ev)) (out[hd] ??= {}).havdalah = t;
  }
  return out;
}
