/**
 * Hebrew date parser for messy input from the family spreadsheet.
 * Handles:
 *   - Transliterated Hebrew numbers ("Chof Gimmel Shvat" = 23 Shvat)
 *   - Hebrew gematria numerals ("כ״ט ניסן" = 29 Nisan)
 *   - Rosh Chodesh shorthand ("ר״ח אדר" = 1 Adar)
 *   - Annotations in parentheses ("Chof Hey Nissan (Isru Chag Pesach)")
 *   - Hebrew year suffixes (5758, 5780, etc.)
 *   - Compound month names ("Menachem Av" = Av)
 */

export interface ParsedHebrewDate {
  day: number;
  month: string;      // hebcal canonical month name
  year?: number;      // Hebrew year, if provided
  note?: string;      // anything in parentheses
  raw: string;        // original input for debugging
}

// Transliterated number words -> numeric values
const TRANSLITERATED_NUMS: Record<string, number> = {
  alef: 1, aleph: 1,
  bais: 2, beis: 2, bet: 2, bes: 2,
  gimmel: 3, gimel: 3,
  daled: 4, dalet: 4, dalet2: 4,
  hey: 5, hei: 5, hay: 5,
  vov: 6, vav: 6,
  zayin: 7, zayen: 7,
  ches: 8, chet: 8, cheis: 8, chai: 18,  // chai (חי) = 18, common Hebrew word for "life"
  tes: 9, tet: 9,
  yud: 10, yod: 10,
  chof: 20, kaf: 20, chaf: 20, kuf: 20,
  lamed: 30,
};

// Hebrew gematria (letter -> value), including final forms
const GEMATRIA: Record<string, number> = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5,
  'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10,
  'כ': 20, 'ך': 20, 'ל': 30,
};

// Month mappings to hebcal canonical names
const MONTH_MAP: Record<string, string> = {
  // Transliterated
  tishrei: 'Tishrei', tishri: 'Tishrei', tishray: 'Tishrei',
  cheshvan: 'Cheshvan', marcheshvan: 'Cheshvan', heshvan: 'Cheshvan', cheshvon: 'Cheshvan',
  kislev: 'Kislev', kislev2: 'Kislev',
  tevet: 'Tevet', teves: 'Tevet', teveis: 'Tevet',
  shvat: 'Shvat', shevat: 'Shvat', shevet: 'Shvat',
  adar: 'Adar',
  'adar i': 'Adar I', 'adar alef': 'Adar I', 'adar rishon': 'Adar I',
  'adar ii': 'Adar II', 'adar beis': 'Adar II', 'adar sheini': 'Adar II', 'adar 2': 'Adar II',
  nissan: 'Nisan', nisan: 'Nisan', nisson: 'Nisan',
  iyar: 'Iyyar', iyyar: 'Iyyar', iyar2: 'Iyyar',
  sivan: 'Sivan', sivan2: 'Sivan',
  tamuz: 'Tamuz', tammuz: 'Tamuz', tammuz2: 'Tamuz',
  av: 'Av', 'menachem av': 'Av', 'menachem-av': 'Av',
  elul: 'Elul',
  // Hebrew script
  'תשרי': 'Tishrei',
  'חשוון': 'Cheshvan', 'חשון': 'Cheshvan', 'מרחשון': 'Cheshvan',
  'כסלו': 'Kislev',
  'טבת': 'Tevet',
  'שבט': 'Shvat',
  'אדר': 'Adar', 'אדר א': 'Adar I', 'אדר ב': 'Adar II',
  'ניסן': 'Nisan',
  'אייר': 'Iyyar',
  'סיון': 'Sivan', 'סיוון': 'Sivan',
  'תמוז': 'Tamuz',
  'אב': 'Av', 'מנחם אב': 'Av',
  'אלול': 'Elul',
};

// Compound month tokens that should be treated as a single unit
const COMPOUND_MONTHS = ['menachem av', 'adar i', 'adar ii', 'adar alef', 'adar beis'];

function parseHebrewGematria(str: string): number {
  // Strip geresh/gershayim (׳ " ' ״ and ASCII equivalents)
  const clean = str.replace(/[׳"'״\"\\]/g, '').trim();
  let value = 0;
  for (const char of clean) {
    const v = GEMATRIA[char];
    if (v) value += v;
  }
  return value;
}

function isHebrewScript(str: string): boolean {
  return /[\u0590-\u05FF]/.test(str);
}

function extractNote(input: string): { text: string; note?: string } {
  const noteMatch = input.match(/\(([^)]+)\)/);
  const note = noteMatch ? noteMatch[1].trim() : undefined;
  const text = input.replace(/\([^)]+\)/g, '').trim();
  return { text, note };
}

function extractHebrewYear(input: string): { text: string; year?: number } {
  // Look for 4-digit numbers in range 5700-5900 (Hebrew years)
  const yearMatch = input.match(/\b(5[789]\d\d)\b/);
  if (yearMatch) {
    return {
      year: parseInt(yearMatch[1], 10),
      text: input.replace(yearMatch[0], '').trim(),
    };
  }
  return { text: input };
}

function parseHebrewScriptDate(input: string): { day: number; month: string } | null {
  const str = input.trim();

  // Check for ר"ח (Rosh Chodesh) = 1st of the month
  if (/ר["״]ח/.test(str)) {
    const monthPart = str.replace(/ר["״]ח\s*/g, '').trim();
    const month = MONTH_MAP[monthPart];
    if (month) return { day: 1, month };
    return null;
  }

  // Try to find a Hebrew month at the end of the string. Match longest names
  // first so e.g. "מנחם אב" isn't shadowed by the shorter "אב" (which would
  // leave "מנחם" in the day part and inflate the parsed day).
  const monthsByLength = Object.entries(MONTH_MAP).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [hebrewMonth, canonical] of monthsByLength) {
    if (!isHebrewScript(hebrewMonth)) continue;
    if (str.endsWith(hebrewMonth) || str.includes(hebrewMonth + ' ')) {
      const dayPart = str.replace(hebrewMonth, '').trim();
      const day = parseHebrewGematria(dayPart);
      if (day > 0 && day <= 30) {
        return { day, month: canonical };
      }
    }
  }

  // Fallback: split by spaces, last token(s) are the month
  const tokens = str.split(/\s+/);
  if (tokens.length >= 2) {
    const possibleMonth = tokens[tokens.length - 1];
    const month = MONTH_MAP[possibleMonth];
    if (month) {
      const dayStr = tokens.slice(0, -1).join('');
      const day = parseHebrewGematria(dayStr);
      if (day > 0 && day <= 30) return { day, month };
    }
  }

  return null;
}

function parseTransliteratedDate(input: string): { day: number; month: string } | null {
  const lower = input.toLowerCase().trim();

  // Check for Rosh Chodesh
  if (lower.startsWith('rosh chodesh') || lower.startsWith('rosh hodesh')) {
    const monthPart = lower.replace(/rosh\s+[ch]odesh\s*/, '').trim();
    const month = MONTH_MAP[monthPart];
    if (month) return { day: 1, month };
  }

  // Try compound month names first (so "Menachem Av" isn't split)
  let monthName = '';
  let remainder = lower;
  for (const compound of COMPOUND_MONTHS) {
    if (lower.endsWith(compound)) {
      monthName = compound;
      remainder = lower.slice(0, lower.length - compound.length).trim();
      break;
    }
  }

  // Otherwise try single-word month at the end
  if (!monthName) {
    const tokens = lower.split(/\s+/);
    const lastToken = tokens[tokens.length - 1];
    if (MONTH_MAP[lastToken]) {
      monthName = lastToken;
      remainder = tokens.slice(0, -1).join(' ').trim();
    }
  }

  if (!monthName) return null;

  const month = MONTH_MAP[monthName];
  if (!month) return null;

  // Parse the number portion
  // Remainder is something like "chof gimmel" or "yud daled" or "tes vov"
  const numTokens = remainder.split(/\s+/).filter(Boolean);

  // Try pairs first (e.g., "chof gimmel" = 23)
  if (numTokens.length === 2) {
    const a = TRANSLITERATED_NUMS[numTokens[0]];
    const b = TRANSLITERATED_NUMS[numTokens[1]];
    if (a !== undefined && b !== undefined) {
      // "Chof Alef" = 20+1=21, "Tes Vov" = 9+6=15, "Yud Daled" = 10+4=14
      return { day: a + b, month };
    }
  }

  // Single number token (e.g., "hey" = 5, "chof" = 20, "lamed" = 30)
  if (numTokens.length === 1) {
    const a = TRANSLITERATED_NUMS[numTokens[0]];
    if (a !== undefined) return { day: a, month };
  }

  return null;
}

/**
 * Parse a messy Hebrew date string into structured components.
 * Throws if the string cannot be parsed — caller should log and skip.
 */
export function parseHebrewDateString(raw: string): ParsedHebrewDate {
  if (!raw || !raw.trim()) {
    throw new Error('Empty date string');
  }

  // 1. Extract parenthetical notes
  const { text: noNote, note } = extractNote(raw);

  // 2. Extract Hebrew year if present
  const { text: noYear, year } = extractHebrewYear(noNote);

  // 3. Strip ~ separators (some entries have "Hebrew ~ English" format — take the Hebrew side)
  const hebrewPart = noYear.split('~')[0].split('\\~')[0].trim();

  if (!hebrewPart) throw new Error(`Empty after stripping: "${raw}"`);

  // 4. Try Hebrew script parsing first
  if (isHebrewScript(hebrewPart)) {
    const result = parseHebrewScriptDate(hebrewPart);
    if (result) return { ...result, year, note, raw };
  }

  // 5. Try transliterated parsing
  const result = parseTransliteratedDate(hebrewPart);
  if (result) return { ...result, year, note, raw };

  throw new Error(`Could not parse Hebrew date: "${raw}"`);
}
