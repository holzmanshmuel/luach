/**
 * Pure helpers for the yahrzeit reminder feed (`/api/reminders/yahrzeit`),
 * extracted so the lead-time + message logic is unit-testable without a DB.
 *
 * "Lead" = days of ADVANCE NOTICE before the yahrzeit's Gregorian date.
 *   - lead = 1 (the default) → remind the day before, i.e. the candle is lit THIS
 *     evening at sundown. This reproduces the endpoint's original behaviour
 *     exactly, so an n8n cron that calls the feed with no `lead` param is
 *     unchanged.
 *   - lead = 7 → a "one week away" heads-up. The n8n workflow can schedule a
 *     second daily call with `?lead=7` for an early reminder, on top of the
 *     nightly candle reminder.
 */

import { fmtLongDay } from './zoned-day';

/** Local `YYYY-MM-DD` (never toISOString — that shifts by the TZ offset). */
export { ymd } from './zoned-day';

export const DEFAULT_LEAD_DAYS = 1;
export const MAX_LEAD_DAYS = 60;

/**
 * Parse & clamp the `lead` query param. Missing / empty / non-integer / out-of-
 * range all fall back to the default (1 = eve-before), so a malformed value can
 * never silently suppress the nightly candle reminder.
 */
export function clampLead(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_LEAD_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LEAD_DAYS) return DEFAULT_LEAD_DAYS;
  return n;
}

/** A friendly "Friday, August 21" style day label. */
export const fmtDay = fmtLongDay;

/**
 * The Gregorian date a reminder with this lead targets: `lead` days from the
 * given "today" (local midnight). lead=1 → tomorrow (candle tonight).
 */
export function targetDateForLead(today: Date, lead: number): Date {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + lead);
  return d;
}

/**
 * Assemble the WhatsApp-ready broadcast text. `lines` are the pre-formatted
 * per-person lines (e.g. "🕯️ Yaakov Levi (9th yahrzeit)"). Returns '' when
 * there is nothing to send, so the caller can skip the broadcast.
 */
export function buildYahrzeitMessage(
  lines: string[],
  target: Date,
  lead: number,
  siteUrl: string,
): string {
  if (lines.length === 0) return '';
  const plural = lines.length > 1;
  const body = `${lines.join('\n')}\n\nMay their memory be a blessing. 🤍\n${siteUrl}`;

  if (lead <= DEFAULT_LEAD_DAYS) {
    // Eve-before: the candle is lit this evening.
    const intro = plural
      ? 'Yahrzeits begin this evening at sundown — light a memorial candle:'
      : 'A yahrzeit begins this evening at sundown — light a memorial candle:';
    return `🕯️ *Yahrzeit reminder* — ${fmtDay(target)}\n\n${intro}\n\n${body}`;
  }

  // Advance heads-up, `lead` days ahead.
  const intro = plural
    ? `Yahrzeits are coming up in ${lead} days, on ${fmtDay(target)}:`
    : `A yahrzeit is coming up in ${lead} days, on ${fmtDay(target)}:`;
  return `🕯️ *Upcoming yahrzeit* — ${fmtDay(target)}\n\n${intro}\n\n${body}`;
}
