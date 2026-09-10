/**
 * Civil-day helpers for the broadcast feeds, evaluated in an explicit TIMEZONE.
 *
 * Two bugs this repo has already paid for shape everything here:
 *
 *  1. **Never `toISOString()` to derive a calendar date.** With `TZ=Asia/Jerusalem`
 *     local midnight is the *previous* day in UTC, so `toISOString().slice(0,10)`
 *     silently reports yesterday — the shape that wrote 38 birthdays a day early
 *     (see `sheet-import.test.ts`). {@link ymd} reads the local Y/M/D fields.
 *  2. **A cron's "today" is a civil date in a place, not an instant.** The daily
 *     digest fires at 08:00 Asia/Jerusalem; which day "today" and "is it Sunday"
 *     mean must be answered in that zone, not in UTC and not in whatever zone the
 *     container happens to boot with.
 *
 * ## Dates here are civil-date CARRIERS
 *
 * A `Date` returned by {@link civilDayInZone} / {@link addDays} is a carrier for a
 * calendar date: only its local Y/M/D are meaningful, and the clock is pinned to
 * local **noon**. Noon (not midnight) because a handful of zones have moved their
 * clocks at 00:00 — `new Date(y, m, d)` there can land on 01:00 or, after a
 * `setHours(0,0,0,0)`, on the previous day. Noon exists in every zone on every
 * day, so the calendar date can never drift.
 *
 * Consequence: compare days by {@link ymd} string, never by `getTime()`, since a
 * caller may hand in a midnight-based Date (the legacy weekly digest does).
 *
 * ## A `Date` never leaves the server
 *
 * The carriers here are a server-side implementation detail. Anything crossing to
 * a **client** component travels as a `CivilDay` (`YYYY-MM-DD`) — see
 * `civil-day.ts` for why, and {@link todayYmd} for the deployment's today.
 */
import { civilDayParts, type CivilDay } from './civil-day';

/**
 * The zone this deployment reckons "today" in: `TZ` when set (Railway sets
 * `TZ=Asia/Jerusalem` in production), else the host's resolved zone, else UTC.
 *
 * `TZ` wins over the resolved zone because Node reads `TZ` for local-time
 * arithmetic; taking anything else here would let the two disagree.
 */
export function deploymentTimeZone(): string {
  const fromEnv = process.env.TZ?.trim();
  if (fromEnv) return fromEnv;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The civil Y/M/D an instant falls on in `timeZone` (host-local if it is invalid). */
function civilPartsInZone(
  at: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const year = part('year');
    const month = part('month');
    const day = part('day');
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return { year, month, day };
    }
  } catch {
    // An unparseable TZ must not take the digest down — fall through to host-local.
  }
  return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() };
}

/**
 * The calendar day `at` falls on **in `timeZone`**, as a civil-date carrier
 * (local noon — see the module note). This is the "today" a cron means.
 */
export function civilDayInZone(
  at: Date = new Date(),
  timeZone: string = deploymentTimeZone()
): Date {
  const { year, month, day } = civilPartsInZone(at, timeZone);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** Local `YYYY-MM-DD`. Never `toISOString()` — that shifts by the TZ offset. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * **The deployment's today, as a `CivilDay` string** — the one value every page
 * should hand its client components instead of letting the browser call
 * `new Date()`.
 *
 * A relative in Los Angeles or Auckland computing "today" in their own browser
 * sees the "today" highlight on a different cell than the family's actual current
 * day; worse, the day itself would be re-derived from a serialised instant. This
 * decides it once, on the server, in `TZ` — and a string cannot be re-interpreted.
 *
 * @see civilDayInZone for the carrier form, and `civil-day.ts` for the string type.
 */
export function todayYmd(
  at: Date = new Date(),
  timeZone: string = deploymentTimeZone()
): CivilDay {
  return ymd(civilDayInZone(at, timeZone));
}

/**
 * A `YYYY-MM-DD` string back to a civil-date CARRIER (local noon — see the module
 * note), for the server-side code that genuinely needs a `Date`: hebcal's
 * `HDate`, the zmanim calculations, range comparisons. Never for a client
 * component — those take the string.
 */
export function civilDayToDate(day: CivilDay): Date {
  const { year, month, day: d } = civilDayParts(day);
  return new Date(year, month - 1, d, 12, 0, 0, 0);
}

/** `days` calendar days after (or before) a civil-date carrier. */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** True when this civil date is a Sunday — the day the weekly look-ahead is sent. */
export function isSunday(d: Date): boolean {
  return d.getDay() === 0;
}

/** The Saturday closing the civil week `d` belongs to (`d` itself if it is one). */
export function saturdayOfWeek(d: Date): Date {
  return addDays(d, 6 - d.getDay());
}

/** "Thu, Sep 10" — the per-line day label the weekly digest already uses. */
export function fmtShortDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Thursday, September 10" — the headline day label the yahrzeit reminder uses. */
export function fmtLongDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
