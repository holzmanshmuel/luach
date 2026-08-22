import type { EventType } from './types';
import type { Lang } from './translations';

/**
 * English ordinal for a positive integer — "1st", "2nd", "3rd", "9th", "11th".
 * Shared so OnThisDay, UpcomingEvents, EventDetailModal and the yahrzeit reminder
 * all phrase the Nth count identically (previously each had its own copy).
 */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * A compact, localized "Nth occasion" label for a birthday / anniversary / yahrzeit,
 * e.g. EN "9th birthday", "9th anniversary", "9th yahrzeit"; HE "יום הולדת 9",
 * "יום נישואין 9", "יארצייט 9". Returns null when the count is unknown or ≤ 0
 * (origin year not on record), so callers can simply omit it.
 *
 * NOTE the deliberate spelling: the user-facing English word is "yahrzeit" (the
 * common English spelling), matching the rest of the UI — even though the internal
 * event_type identifier is 'yahrtzeit'. See lib/types.ts.
 */
export function countLabel(
  type: EventType,
  years: number | null | undefined,
  lang: Lang,
): string | null {
  if (!years || years <= 0) return null;
  const he = lang === 'he';
  switch (type) {
    case 'birthday':
      return he ? `יום הולדת ${years}` : `${ordinal(years)} birthday`;
    case 'anniversary':
      return he ? `יום נישואין ${years}` : `${ordinal(years)} anniversary`;
    case 'yahrtzeit':
      return he ? `יארצייט ${years}` : `${ordinal(years)} yahrzeit`;
    default:
      return null;
  }
}
