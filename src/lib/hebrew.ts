import { HDate, months } from '@hebcal/core';

// Months whose identity is independent of leap years.
const FIXED_MONTH_TO_NUM: Record<string, number> = {
  Tishrei: months.TISHREI,
  Cheshvan: months.CHESHVAN,
  Kislev: months.KISLEV,
  Tevet: months.TEVET,
  Shvat: months.SHVAT,
  Nisan: months.NISAN,
  Iyyar: months.IYYAR,
  Sivan: months.SIVAN,
  Tamuz: months.TAMUZ,
  Av: months.AV,
  Elul: months.ELUL,
};

/**
 * Resolve a stored month name to the hebcal month number FOR A SPECIFIC Hebrew
 * year, applying the Adar-in-leap-year rule consistently with the calendar grid:
 *
 *  - 'Adar' (a generic Adar from a non-leap birth) recurs in **Adar II** in leap
 *    years and in the single Adar otherwise — matching @hebcal's
 *    getBirthdayOrAnniversary and the common custom used by dbMonthLabels.
 *  - 'Adar I' / 'Adar II' are honoured in leap years and collapse to the single
 *    Adar in non-leap years (there is only one Adar then).
 *
 * Returns null for an unknown month name.
 */
function resolveMonthNum(month: string, hebrewYear: number): number | null {
  const leap = HDate.isLeapYear(hebrewYear);
  if (month === 'Adar') return leap ? months.ADAR_II : months.ADAR_I;
  if (month === 'Adar I') return months.ADAR_I; // month 12 — the (only) Adar in non-leap years
  if (month === 'Adar II') return leap ? months.ADAR_II : months.ADAR_I;
  return FIXED_MONTH_TO_NUM[month] ?? null;
}

/**
 * Display name for a hebcal month number in a given Hebrew year. Month 12 is
 * "Adar" in a non-leap year but "Adar I" in a leap year; month 13 is "Adar II".
 */
function hebrewMonthName(monthNum: number, hebrewYear: number): string {
  if (monthNum === months.ADAR_I) return HDate.isLeapYear(hebrewYear) ? 'Adar I' : 'Adar';
  if (monthNum === months.ADAR_II) return 'Adar II';
  const entry = Object.entries(FIXED_MONTH_TO_NUM).find(([, num]) => num === monthNum);
  return entry ? entry[0] : new HDate(1, monthNum, hebrewYear).getMonthName();
}

/**
 * Convert a recurring Hebrew day/month to its Gregorian date within a given
 * Gregorian year. Returns null if it doesn't fall in that Gregorian year.
 *
 * Two correctness rules are applied (verified against @hebcal/core):
 *  - **Adar** resolves per-year via {@link resolveMonthNum} so leap-year Adar
 *    occasions land in the right Adar (and agree with the Hebrew-grid view).
 *  - The day is **clamped to the month's actual length**, so 30 Cheshvan / 30
 *    Kislev fall on the 29th in years where that month is short (rather than
 *    silently rolling into the next month, which @hebcal does by default) —
 *    matching the customary "observe on the last day of the month" practice.
 */
export function hebrewToGregorian(
  day: number,
  month: string,
  gregYear: number
): Date | null {
  // Back-compat single-value form: the first occurrence in the civil year.
  return hebrewToGregorianAll(day, month, gregYear)[0] ?? null;
}

/**
 * ALL Gregorian dates on which a recurring Hebrew day/month falls within a given
 * Gregorian year — usually one, but TWO near the Dec/Jan boundary (a civil year
 * overlaps two Hebrew years, so e.g. 5 Tevet can land in early January AND late
 * December of the same civil year). Returning only the first (as the old
 * single-value function did) silently dropped the December occurrence from the
 * calendar grid, the iCal feed, and the yahrzeit/digest reminders. Same two
 * correctness rules as before: Adar resolves per-year, and the day is clamped to
 * the month's real length (30 -> 29 in a short Cheshvan/Kislev).
 */
export function hebrewToGregorianAll(
  day: number,
  month: string,
  gregYear: number
): Date[] {
  const out: Date[] = [];
  for (const hebrewYear of [gregYear + 3760, gregYear + 3761]) {
    const monthNum = resolveMonthNum(month, hebrewYear);
    if (!monthNum) continue;
    const maxDay = HDate.daysInMonth(monthNum, hebrewYear);
    const effectiveDay = Math.min(day, maxDay); // 30 -> 29 in a short month
    const greg = new HDate(effectiveDay, monthNum, hebrewYear).greg();
    if (greg.getFullYear() === gregYear) out.push(greg);
  }
  return out;
}

/**
 * Find the next upcoming Gregorian occurrence of a Hebrew date (today or future).
 */
export function getNextOccurrence(
  day: number,
  month: string
): { gregorianDate: Date; hebrewYear: number } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Gather every occurrence across this civil year and next (a Hebrew date can
  // occur twice in a civil year), then take the earliest one that's today or
  // later — otherwise a late-December date would be skipped for its January twin.
  const candidates: Date[] = [];
  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    candidates.push(...hebrewToGregorianAll(day, month, today.getFullYear() + yearOffset));
  }
  const next = candidates
    .filter(d => d >= today)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!next) return null;
  // Derive the Hebrew year from the resulting date rather than a fixed offset
  // (which is off-by-one for Tevet–Adar, which fall in Jan–Mar).
  return { gregorianDate: next, hebrewYear: new HDate(next).getFullYear() };
}

/**
 * Get all Gregorian occurrences of a Hebrew date within a date range (inclusive).
 */
export function getOccurrencesInRange(
  day: number,
  month: string,
  startDate: Date,
  endDate: Date
): Date[] {
  const results: Date[] = [];
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    // All occurrences in the year (usually one, two near the Dec/Jan boundary).
    for (const d of hebrewToGregorianAll(day, month, year)) {
      if (d >= startDate && d <= endDate) results.push(d);
    }
  }
  return results;
}

/**
 * Convert a Gregorian date to its Hebrew date components.
 */
export function gregorianToHebrew(date: Date): {
  day: number;
  month: string;
  year: number;
} {
  const hd = new HDate(date);
  return {
    day: hd.getDate(),
    month: hebrewMonthName(hd.getMonth(), hd.getFullYear()),
    year: hd.getFullYear(),
  };
}

/**
 * Format a Hebrew date for display, e.g. "15 Nisan" or "15 Nisan 5784".
 */
export function formatHebrewDate(
  day: number,
  month: string,
  year?: number | null
): string {
  return year ? `${day} ${month} ${year}` : `${day} ${month}`;
}

/**
 * Convert a Gregorian month/day/year to the Hebrew date that fell on that exact date.
 * This is the "source of truth" conversion used when someone enters their English birthday.
 * The result (hebrew_day + hebrew_month) becomes the recurring annual date going forward.
 */
export function exactGregorianToHebrew(
  month: number,   // 1-indexed
  day: number,
  year: number
): { day: number; month: string; hebrewYear: number } | null {
  try {
    const date = new Date(year, month - 1, day);
    const hd = new HDate(date);
    return {
      day: hd.getDate(),
      month: hebrewMonthName(hd.getMonth(), hd.getFullYear()),
      hebrewYear: hd.getFullYear(),
    };
  } catch {
    return null;
  }
}

interface BirthLike {
  hebrew_day: number;
  hebrew_month: string;
  hebrew_year?: number | null;
  gregorian_year?: number | null;
  original_english_date?: string | null;
}

/** The Hebrew year of birth/origin, from the best available source, or null. */
function birthHebrewYear(b: BirthLike): number | null {
  if (b.hebrew_year) return b.hebrew_year;
  if (b.original_english_date) {
    const m = b.original_english_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return exactGregorianToHebrew(Number(m[2]), Number(m[3]), Number(m[1]))?.hebrewYear ?? null;
  }
  if (b.gregorian_year) {
    const g = hebrewToGregorian(b.hebrew_day, b.hebrew_month, b.gregorian_year);
    if (g) return new HDate(g).getFullYear();
  }
  return null;
}

/**
 * How many years the occasion marks on a given occurrence (an Nth birthday /
 * anniversary / yahrzeit), computed in HEBREW years — the event recurs by its
 * Hebrew date, so subtracting Gregorian years is off by one for Tevet–Adar
 * (Dec–Mar) occurrences that cross Jan 1. Returns null when the origin year is
 * unknown or the result isn't a positive count.
 */
export function yearsSinceForHebrewYear(occurrenceHebrewYear: number, birth: BirthLike): number | null {
  const by = birthHebrewYear(birth);
  if (!by) return null;
  const n = occurrenceHebrewYear - by;
  return n > 0 ? n : null;
}

/** Same, from an occurrence's Gregorian date. */
export function yearsSince(occurrenceGreg: Date, birth: BirthLike): number | null {
  return yearsSinceForHebrewYear(new HDate(occurrenceGreg).getFullYear(), birth);
}

/**
 * Calculate days until a given date from today (negative if in the past).
 */
export function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
