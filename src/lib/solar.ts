/**
 * The recurring Gregorian date of a fixed (month, day) in a given year, with
 * Feb-29 clamped to Feb-28 in non-leap years (rather than rolling over to Mar 1).
 *
 * Shared by the in-app calendar and the iCal feed so a leap-day birthday lands on
 * the SAME day in both — `new Date(year, 1, 29)` silently becomes Mar 1, which is
 * the bug this guards against.
 *
 * `month` is 0-indexed (0 = January), matching the JS Date convention.
 */
export function solarDateInYear(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  d.setHours(0, 0, 0, 0);
  if (d.getMonth() !== month) {
    const lastOfMonth = new Date(year, month + 1, 0); // day 0 = last day of `month`
    lastOfMonth.setHours(0, 0, 0, 0);
    return lastOfMonth;
  }
  return d;
}
