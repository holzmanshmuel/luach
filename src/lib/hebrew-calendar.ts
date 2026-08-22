import { HDate, months, gematriya } from '@hebcal/core';

export interface HebrewMonthCell {
  hebrewDay: number;   // 1..30
  gematria: string;    // 'א׳' .. 'ל׳'
  gregorian: Date;     // civil date this Hebrew day falls on
  weekday: number;     // 0=Sun .. 6=Sat
}

export interface HebrewMonthModel {
  hebrewMonth: number;     // hebcal month number (NISAN=1 .. ADAR_II=13)
  hebrewYear: number;      // e.g. 5786
  monthLabelHe: string;    // 'סיון'
  yearLabelHe: string;     // 'התשפ״ו'
  days: HebrewMonthCell[]; // length 29 or 30
  leadingBlanks: number;   // weekday offset of day 1
}

/** Hebrew year label for the 6th millennium, e.g. 5786 -> 'התשפ״ו'. */
export function heYearLabel(hebrewYear: number): string {
  // thousands digit of 5xxx is 5 = ה; gematriya() crops the thousands.
  return 'ה' + gematriya(hebrewYear);
}

export function getHebrewMonthForGregorian(date: Date): {
  hebrewMonth: number;
  hebrewYear: number;
} {
  const hd = new HDate(date);
  return { hebrewMonth: hd.getMonth(), hebrewYear: hd.getFullYear() };
}

export function buildHebrewMonth(
  hebrewMonth: number,
  hebrewYear: number
): HebrewMonthModel {
  const numDays = HDate.daysInMonth(hebrewMonth, hebrewYear);
  const days: HebrewMonthCell[] = [];
  for (let d = 1; d <= numDays; d++) {
    const greg = new HDate(d, hebrewMonth, hebrewYear).greg();
    days.push({
      hebrewDay: d,
      gematria: gematriya(d),
      gregorian: greg,
      weekday: greg.getDay(),
    });
  }
  const enName = HDate.getMonthName(hebrewMonth, hebrewYear);
  return {
    hebrewMonth,
    hebrewYear,
    monthLabelHe: HEBREW_MONTH_LABELS[enName] ?? enName,
    yearLabelHe: heYearLabel(hebrewYear),
    days,
    leadingBlanks: days[0].weekday,
  };
}

/** Step ±1 Hebrew month using a Gregorian bridge (robust across years + Adar). */
export function stepHebrewMonth(
  hebrewMonth: number,
  hebrewYear: number,
  delta: 1 | -1
): { hebrewMonth: number; hebrewYear: number } {
  const firstGreg = new HDate(1, hebrewMonth, hebrewYear).greg();
  const bridge = new Date(firstGreg);
  if (delta === 1) {
    // day-1 of next month = first day after this month ends
    bridge.setDate(bridge.getDate() + HDate.daysInMonth(hebrewMonth, hebrewYear));
  } else {
    // last day of previous month = the day before day-1 of this month
    bridge.setDate(bridge.getDate() - 1);
  }
  const hd = new HDate(bridge);
  return { hebrewMonth: hd.getMonth(), hebrewYear: hd.getFullYear() };
}

// English (hebcal) month name -> Hebrew label.
const HEBREW_MONTH_LABELS: Record<string, string> = {
  Nisan: 'ניסן', Iyyar: 'אייר', Sivan: 'סיון', Tamuz: 'תמוז', Av: 'אב',
  Elul: 'אלול', Tishrei: 'תשרי', Cheshvan: 'חשון', Kislev: 'כסלו',
  Tevet: 'טבת', "Sh'vat": 'שבט', Shvat: 'שבט', Adar: 'אדר',
  'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳',
};

export { months };
