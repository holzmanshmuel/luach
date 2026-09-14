import type { Finding } from '@/lib/date-consistency';
import { formatCivilDayLocalized, formatHebrewDateLocalized } from '@/lib/date-format';
import { isCivilDay } from '@/lib/civil-day';
import { T, type Lang } from '@/lib/translations';

/**
 * The dates a date-check finding talks about, formatted for the reader's language
 * with the SAME helpers the calendar itself uses — Hebrew numerals and month names
 * on a Hebrew page, `June 7, 1978` on an English one. Pure, so the server page (the
 * Adar list) and the client list (the problem rows) cannot format them differently.
 *
 * A stored English date that is not a real `YYYY-MM-DD` (that is exactly what an
 * `unconvertible` row can hold) is shown as typed rather than run through a
 * formatter that would roll it over into a different, plausible-looking day.
 */
export interface FindingDates {
  /** The stored recurring Hebrew date, no year. */
  hebrew: string;
  /** The stored English date. */
  english: string;
  /** The English date the Hebrew one implies — the suggested correction. */
  expected: string;
  /** The Hebrew date the stored English date actually fell on, with its year. */
  fallsOn: string;
}

const MISSING = '—';

function civil(day: string | null, lang: Lang): string {
  if (day === null) return MISSING;
  return isCivilDay(day) ? formatCivilDayLocalized(day, lang) : day;
}

export function findingDates(f: Finding, lang: Lang): FindingDates {
  const parts = f.english_falls_on_parts;
  return {
    hebrew: formatHebrewDateLocalized(f.hebrew_day, f.hebrew_month, null, lang),
    english: civil(f.stored_english, lang),
    expected: civil(f.expected_english, lang),
    fallsOn: parts
      ? formatHebrewDateLocalized(parts.day, parts.month, parts.hebrewYear, lang)
      : (f.english_falls_on ?? MISSING),
  };
}

/** "Birthday" / "יום הולדת" — the event type as the calendar labels it; unknown types as stored. */
export function eventTypeLabel(eventType: string, t: (key: string) => string): string {
  const key = `event.${eventType}`;
  return key in T.en ? t(key) : eventType;
}
