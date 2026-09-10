/**
 * A **civil day** — one calendar day as `YYYY-MM-DD`, with no clock and no zone.
 *
 * ## Why this type exists
 *
 * This repo has now paid three times for the same mistake in three different
 * disguises: `toISOString()` (38 birthdays written a day early), a DATE column
 * read back as a `Date` at local midnight, and — the reason this module exists —
 * a `Date` handed from a Server Component to a **client** component.
 *
 * React's wire format preserves the *instant*, not the calendar day. A birthday
 * built on the server (`TZ=Asia/Jerusalem`) at local midnight on 4 Sep 2026
 * serialises as `2026-09-03T21:00:00.000Z`, and `.getDate()` in the browser then
 * answers in the VIEWER's zone:
 *
 *     Asia/Jerusalem      -> 4 Sept   (right)
 *     Europe/London       -> 3 Sept   (wrong)
 *     America/Los_Angeles -> 3 Sept   (wrong)
 *
 * Every relative outside Israel saw every birthday, anniversary and yahrzeit one
 * day early. The pure-function suite could not see it: the bug lived at a process
 * boundary, not inside a function.
 *
 * ## The rule
 *
 * **A calendar day is decided ONCE, on the server, in the deployment's timezone
 * (see `zoned-day.ts`), and travels as a `CivilDay` string.** A string cannot be
 * re-interpreted by the reader's clock, so no client component may derive a
 * calendar day from a `Date` instant — and nothing in `src/app/components`
 * should need a `Date` at all.
 *
 * Everything here is pure string/UTC arithmetic: identical in every viewer
 * timezone, immune to DST (there is no such thing as a DST transition in a
 * date-only value), and safe to import into a client bundle.
 *
 * `zoned-day.ts` is the other half: it turns an *instant* into a `CivilDay` in an
 * explicit zone, and back into a noon-anchored carrier for server code that still
 * needs a real `Date` (hebcal, zmanim).
 */

/** One calendar day, `YYYY-MM-DD`. Zero-padded, no clock, no timezone. */
export type CivilDay = string;

const PATTERN = /^(-?\d{4,6})-(\d{2})-(\d{2})$/;

/** True for a well-formed, real `YYYY-MM-DD` day (rejects `2026-02-31`). */
export function isCivilDay(value: unknown): value is CivilDay {
  if (typeof value !== 'string') return false;
  const m = PATTERN.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC so 31 February and 29 February in a common year fail.
  return toUTC(Number(y), month, day) === value;
}

/** Assemble a day from its parts. `month` is 1-indexed, matching the string. */
export function civilDayFromParts(year: number, month: number, day: number): CivilDay {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** The `{ year, month (1-12), day }` of a civil day. Throws on a malformed one. */
export function civilDayParts(day: CivilDay): { year: number; month: number; day: number } {
  const m = PATTERN.exec(day);
  if (!m) throw new Error(`Not a YYYY-MM-DD civil day: ${JSON.stringify(day)}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Calendar year, e.g. 2026. */
export function civilYear(day: CivilDay): number {
  return civilDayParts(day).year;
}

/** Month as a **0-indexed** number, matching `Date#getMonth` and the UI's keys. */
export function civilMonthIndex(day: CivilDay): number {
  return civilDayParts(day).month - 1;
}

/** Day of the month, 1-31 — what a calendar cell prints. */
export function civilDayOfMonth(day: CivilDay): number {
  return civilDayParts(day).day;
}

/** True when `day` falls in this 0-indexed Gregorian month of this year. */
export function isInCivilMonth(day: CivilDay, year: number, monthIndex: number): boolean {
  const p = civilDayParts(day);
  return p.year === year && p.month - 1 === monthIndex;
}

/**
 * `delta` calendar days after (or before) `day`.
 *
 * Done in UTC on purpose: a local-midnight `setDate()` walk can land on the
 * previous day in a zone that moves its clock at 00:00, which is exactly the
 * class of bug the noon-carrier convention in `zoned-day.ts` guards against.
 * UTC has no DST at all, so a date-only step is always exactly one day.
 */
export function addCivilDays(day: CivilDay, delta: number): CivilDay {
  const { year, month, day: d } = civilDayParts(day);
  return toUTC(year, month, d + delta);
}

/** `-1 | 0 | 1`, ordering days chronologically (ISO strings sort correctly). */
export function compareCivilDays(a: CivilDay, b: CivilDay): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole calendar days from `from` to `to` — negative when `to` is earlier. */
export function civilDaysBetween(from: CivilDay, to: CivilDay): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** True when `day` is inside the inclusive `[from, to]` window. */
export function isWithinCivilDays(day: CivilDay, from: CivilDay, to: CivilDay): boolean {
  return day >= from && day <= to;
}

/** Day of week, 0 = Sunday .. 6 = Saturday. Zone-independent (computed in UTC). */
export function civilWeekday(day: CivilDay): number {
  return new Date(utcMs(day)).getUTCDay();
}

/**
 * The shape of a Gregorian month grid: which weekday the 1st lands on, and how
 * many days the month has. `monthIndex` is 0-indexed, matching `Date#getMonth`.
 *
 * All in UTC, so the grid a viewer in Auckland draws is the grid a viewer in Los
 * Angeles draws — and a zone that moves its clock at 00:00 (where
 * `new Date(y, m, 1)` can land on the last day of the previous month) cannot
 * shift the whole calendar by a column.
 */
export function civilMonthGrid(
  year: number,
  monthIndex: number
): { firstWeekday: number; days: number } {
  const first = new Date(0);
  first.setUTCFullYear(year, monthIndex, 1);
  first.setUTCHours(0, 0, 0, 0);
  const afterLast = new Date(0);
  afterLast.setUTCFullYear(year, monthIndex + 1, 0); // day 0 = last day of monthIndex
  afterLast.setUTCHours(0, 0, 0, 0);
  return { firstWeekday: first.getUTCDay(), days: afterLast.getUTCDate() };
}

// ── internals ────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return n < 0 ? `-${String(-n).padStart(4, '0')}` : String(n).padStart(4, '0');
}

/** Normalise possibly out-of-range parts (e.g. day 32) through UTC. */
function toUTC(year: number, month: number, day: number): CivilDay {
  const t = new Date(Date.UTC(2000, month - 1, day));
  // setUTCFullYear separately so years < 100 aren't mapped into the 1900s.
  t.setUTCFullYear(year, month - 1, day);
  return civilDayFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function utcMs(day: CivilDay): number {
  const { year, month, day: d } = civilDayParts(day);
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, d);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}
