/**
 * Pure helpers for the spreadsheet importer (`scripts/import-sheet.ts`).
 *
 * They live here rather than inside the script so they can be tested: the
 * script reads argv and opens a Postgres pool the moment it is imported, which
 * a unit test cannot do. Everything here is side-effect free.
 *
 * The Hebrew-date reading itself is the `parse-hebrew-date` package (the parser
 * that grew up in this repo, extracted so other projects can use it). This
 * module owns the two things that stay app-specific: translating the package's
 * month vocabulary into the one this app stores, and reading the English date
 * column without losing a day to the host timezone.
 */
import { parseHebrewDate, type HebrewMonthName } from 'parse-hebrew-date';

// ---------------------------------------------------------------------------
// Month vocabulary
// ---------------------------------------------------------------------------

/**
 * The canonical Hebrew month names this app stores in `events.hebrew_month`.
 *
 * `src/lib/hebrew.ts` is the source of truth: these are exactly the strings
 * `resolveMonthNum` there can turn into a hebcal month number. A value outside
 * this set is stored happily by Postgres (the column is plain `text`) and then
 * resolves to nothing — the person simply stops appearing on the calendar. That
 * is why the mapping below is explicit and loud rather than a pass-through.
 */
export type AppHebrewMonth =
  | 'Tishrei'
  | 'Cheshvan'
  | 'Kislev'
  | 'Tevet'
  | 'Shvat'
  | 'Adar'
  | 'Adar I'
  | 'Adar II'
  | 'Nisan'
  | 'Iyyar'
  | 'Sivan'
  | 'Tamuz'
  | 'Av'
  | 'Elul';

/**
 * Every month `parse-hebrew-date` can produce, mapped to the app's form.
 *
 * The two vocabularies happen to agree today, so every entry is an identity
 * pair — but they are two independently versioned lists, and a package release
 * that renamed `Iyyar` to `Iyar` would otherwise write a month the calendar
 * cannot resolve, silently, on every future import. Typing this as a
 * `Record<HebrewMonthName, …>` makes the compiler reject a package that adds a
 * month, and {@link toAppMonth} rejects one at runtime.
 */
const PACKAGE_MONTH_TO_APP: Record<HebrewMonthName, AppHebrewMonth> = {
  Tishrei: 'Tishrei',
  Cheshvan: 'Cheshvan',
  Kislev: 'Kislev',
  Tevet: 'Tevet',
  Shvat: 'Shvat',
  Adar: 'Adar',
  'Adar I': 'Adar I',
  'Adar II': 'Adar II',
  Nisan: 'Nisan',
  Iyyar: 'Iyyar',
  Sivan: 'Sivan',
  Tamuz: 'Tamuz',
  Av: 'Av',
  Elul: 'Elul',
};

/**
 * Thrown when `parse-hebrew-date` produces a month this app has no form for.
 *
 * Its own class so the importer can tell it apart from an unreadable cell: a
 * cell it cannot read is one person to add by hand, but an unmapped month means
 * the two vocabularies have drifted and *every* row carrying that month is
 * wrong. The importer aborts on this rather than counting it as a row warning.
 */
export class UnmappedHebrewMonthError extends Error {
  /** The month name that had no mapping. */
  readonly month: string;

  constructor(month: string) {
    super(
      `Unmapped Hebrew month from parse-hebrew-date: ${JSON.stringify(month)}. ` +
        'Add it to PACKAGE_MONTH_TO_APP in src/lib/sheet-import.ts (and teach ' +
        'src/lib/hebrew.ts to resolve it) — importing it unmapped would store a ' +
        'month the calendar cannot resolve.'
    );
    this.name = 'UnmappedHebrewMonthError';
    this.month = month;
  }
}

/**
 * Translate a month name from `parse-hebrew-date` into the app's canonical
 * form, throwing {@link UnmappedHebrewMonthError} on anything unmapped.
 *
 * Throwing is deliberate: a month string the app cannot resolve produces rows
 * that look imported and then never appear on the calendar, which is far worse
 * to discover months later than a loud stop now.
 */
export function toAppMonth(month: string): AppHebrewMonth {
  const mapped = (PACKAGE_MONTH_TO_APP as Record<string, AppHebrewMonth | undefined>)[month];
  if (!mapped) throw new UnmappedHebrewMonthError(month);
  return mapped;
}

// ---------------------------------------------------------------------------
// English dates
// ---------------------------------------------------------------------------

/** Local calendar date as `YYYY-MM-DD`, with no UTC conversion anywhere. */
function formatLocalYmd(d: Date): string {
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Read an English date cell — `"February 8, 1961"`, `"Aug. 3, 1971"`,
 * `"1961-02-08"` — into the `YYYY-MM-DD` string the `date` column takes.
 * Returns null for a blank or unreadable cell.
 *
 * **The calendar date is preserved on any host timezone.** This used to build
 * `new Date(raw)` — local midnight — and then take `toISOString()`, which is
 * UTC: east of Greenwich local midnight is still the *previous* day in UTC, so
 * every date came out one day early (38 of them, in this app's own production
 * data). Both paths below stay in the local/civil frame: an already-ISO cell is
 * returned as written, and anything else is formatted back out of the same
 * local fields `new Date` parsed it into.
 */
export function parseEnglishDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  // Already a plain calendar date: hand it back untouched rather than round-trip
  // it through a Date, which would read it as UTC midnight and shift it west of
  // Greenwich. Still checked for real-ness so 2020-13-45 fails here, not in the
  // INSERT.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const real =
      probe.getUTCFullYear() === Number(y) &&
      probe.getUTCMonth() === Number(m) - 1 &&
      probe.getUTCDate() === Number(d);
    return real ? trimmed : null;
  }

  // Drop the periods in month abbreviations ("Aug. 3, 1971").
  const normalized = trimmed.replace(/\./g, '').trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalYmd(parsed);
}

// ---------------------------------------------------------------------------
// The anniversary column
// ---------------------------------------------------------------------------

/** The two halves of an anniversary cell, either of which may be absent. */
export interface AnniversaryCell {
  /** The half that reads as a Hebrew date, or null if neither does. */
  hebrew: string | null;
  /** The other half, if there was one — assumed to be the English date. */
  english: string | null;
}

/**
 * Split an anniversary cell into its Hebrew and English halves.
 *
 * The column is written both ways round — `"ח' שבט ~ January 23"` and
 * `"January 23 ~ ח' שבט"` — and CSV exports leave the separator escaped as
 * `\~`, so the halves are identified by which one actually parses as a Hebrew
 * date rather than by position.
 */
export function splitAnniversaryCell(raw: string | null | undefined): AnniversaryCell {
  if (!raw || !raw.trim()) return { hebrew: null, english: null };

  const parts = raw
    .split(/\\?~/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (let i = 0; i < parts.length; i++) {
    if (parseHebrewDate(parts[i])) {
      return { hebrew: parts[i], english: parts.find((_, j) => j !== i) ?? null };
    }
  }
  return { hebrew: null, english: null };
}
