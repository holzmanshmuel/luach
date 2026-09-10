import { gematriya } from '@hebcal/core';
import type { Lang } from './translations';
import { heYearLabel } from './hebrew-calendar';
import { civilDayParts, type CivilDay } from './civil-day';

// Hebrew month labels keyed by the app's transliterated month strings.
const HE_MONTH: Record<string, string> = {
  Tishrei: 'תשרי', Cheshvan: 'חשון', Kislev: 'כסלו', Tevet: 'טבת',
  Shvat: 'שבט', Adar: 'אדר', 'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳',
  Nisan: 'ניסן', Iyyar: 'אייר', Sivan: 'סיון', Tamuz: 'תמוז',
  Av: 'אב', Elul: 'אלול',
};

/** A Hebrew-month option label for a picker: Hebrew name in Hebrew mode, else the
 *  stored transliteration (which stays the option's value). */
export function monthOptionLabel(month: string, lang: Lang): string {
  return lang === 'he' ? (HE_MONTH[month] ?? month) : month;
}

// Gregorian month -> Hebrew (genitive "בـ" form).
const HE_GREG_MONTH = [
  'בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני',
  'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר',
];

export function formatHebrewDateLocalized(
  day: number, month: string, year: number | null, lang: Lang
): string {
  if (lang === 'he') {
    const m = HE_MONTH[month] ?? month;
    const base = `${gematriya(day)} ${m}`;
    return year ? `${base} ${heYearLabel(year)}` : base;
  }
  return year ? `${day} ${month} ${year}` : `${day} ${month}`;
}

/**
 * A civil day as a sentence: `September 4, 2026` / `4 בספטמבר 2026`.
 *
 * Takes the day as `YYYY-MM-DD`, never a `Date`. The `Date`-taking version this
 * replaced formatted whatever day the reader's own clock said the instant fell
 * on, so a birthday rendered a day early for every relative west of Israel.
 *
 * Zone-independent by construction: the parts come off the string, and the one
 * `Intl` call is pinned to `timeZone: 'UTC'` against a UTC-built instant, so a
 * viewer in Los Angeles and one in Auckland render the identical sentence. Format
 * a `Date` here and the day would shift, which is the bug this replaces.
 */
export function formatCivilDayLocalized(day: CivilDay, lang: Lang): string {
  const { year, month, day: d } = civilDayParts(day);
  if (lang === 'he') {
    return `${d} ${HE_GREG_MONTH[month - 1]} ${year}`;
  }
  return utcInstant(year, month, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

/** `Sep 4` — the small civil-date note on a Hebrew-grid cell. Zone-independent. */
export function formatCivilDayShort(day: CivilDay): string {
  const { year, month, day: d } = civilDayParts(day);
  return utcInstant(year, month, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/**
 * A UTC instant standing for a civil day, for the `Intl` calls above ONLY — every
 * one of them passes `timeZone: 'UTC'`, so the instant is never re-projected into
 * the reader's zone. Do not return this to a caller.
 */
function utcInstant(year: number, month: number, day: number): Date {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  t.setUTCHours(12, 0, 0, 0);
  return t;
}
