/**
 * The two writes behind the Date-check page's one-click corrections.
 *
 * Extracted from the server action on purpose. The action itself cannot be run in
 * a test without a request, a session and a cookie, so when the SQL lived inside
 * it the UPDATEs were never executed by anything until a real person clicked the
 * button in production — where they failed on a type error that a single test
 * would have caught. These functions are tenant-scoped and DB-backed, so a test
 * can drive the real statements against a real Postgres.
 *
 * Both are tenant-scoped via `query()`: RLS restricts the row to the caller's
 * active family, so a guessed id from another family updates nothing.
 */
import { query } from './db';

/**
 * Point an event's civil date at `ymd` (`YYYY-MM-DD`), keeping `gregorian_year`
 * in step when the row carries one.
 *
 * ⚠️ The casts are load-bearing. In `CASE WHEN col IS NULL THEN NULL ELSE $n END`
 * the only other branch is an untyped NULL, so Postgres has nothing to infer the
 * parameter's type from and falls back to text — then rejects the whole statement
 * with `column "gregorian_year" is of type integer but expression is of type text`.
 * Annotating the parameter is what makes the type unambiguous.
 *
 * Returns the number of rows changed: 0 means the id was not this family's.
 */
export async function setEventEnglishDate(eventId: number, ymd: string): Promise<number> {
  const year = Number(ymd.slice(0, 4));
  const rows = await query<{ id: number }>(
    `UPDATE family_calendar.events
        SET original_english_date = $1::date,
            gregorian_year = CASE WHEN gregorian_year IS NULL THEN NULL ELSE $2::int END,
            updated_at = NOW()
      WHERE id = $3
      RETURNING id`,
    [ymd, year, eventId]
  );
  return rows.length;
}

/**
 * Point an event's recurring Hebrew date at `day`/`month`, keeping `hebrew_year`
 * in step when the row carries one. Same casting rule as above.
 */
export async function setEventHebrewDate(
  eventId: number,
  day: number,
  month: string,
  hebrewYear: number
): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE family_calendar.events
        SET hebrew_day = $1::int,
            hebrew_month = $2::text,
            hebrew_year = CASE WHEN hebrew_year IS NULL THEN NULL ELSE $3::int END,
            updated_at = NOW()
      WHERE id = $4
      RETURNING id`,
    [day, month, hebrewYear, eventId]
  );
  return rows.length;
}
