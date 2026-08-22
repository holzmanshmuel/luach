import { gematriya } from '@hebcal/core';
import type { Lang } from './translations';
import { heYearLabel } from './hebrew-calendar';

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

export function formatGregorianLocalized(date: Date, lang: Lang): string {
  if (lang === 'he') {
    return `${date.getDate()} ${HE_GREG_MONTH[date.getMonth()]} ${date.getFullYear()}`;
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
