/**
 * Bulk-import a family from a CSV export of a spreadsheet.
 *
 * Most families already keep their birthdays and yahrzeits in a spreadsheet.
 * This reads that export straight into one family's calendar, parsing the messy
 * hand-written Hebrew dates people actually type ("ח' שבט", "15 Adar II").
 *
 * Expected columns (header row is skipped, order matters):
 *   1. Name             — "Miriam Levi"; a "~" splits a married name, e.g. "Dina Cohen~Levi"
 *   2. Hebrew Birthday  — "ח' שבט" / "8 Shvat 5745" / blank
 *   3. English Birthday — "February 8, 1961" / blank
 *   4. Anniversary      — Hebrew and/or English, separated by "~" / blank
 *   5. Branch           — OPTIONAL. One of FAMILY_BRANCHES (src/lib/types.ts).
 *                         Blank → inferred from the surname in column 1.
 *
 * Usage:
 *   DATABASE_URL="postgres://app_user:...@host/db" \
 *     npx tsx scripts/import-sheet.ts data.csv --family=1
 *
 * --family=<id> is REQUIRED: every row belongs to exactly one family, and the
 * tables are row-level-security scoped by it. Find the id in the app URL after
 * switching families, or query `SELECT id, name FROM family_calendar.families`.
 *
 * DESTRUCTIVE: clears that ONE family's people and events before inserting, so
 * re-running gives the same result instead of duplicating everyone. Other
 * families are untouched (RLS makes that structural, not just a WHERE clause).
 * Rows whose Hebrew date cannot be parsed are skipped with a warning and printed
 * in a summary at the end — add those few by hand in the app.
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { parseHebrewDateString } from '../src/lib/hebrew-parser';
import { FAMILY_BRANCHES } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const CSV_PATH = args.find(a => !a.startsWith('--')) ?? 'data.csv';
const familyArg = args.find(a => a.startsWith('--family='))?.split('=')[1];
const FAMILY_ID = Number(familyArg);
const DATABASE_URL = process.env.DATABASE_URL;

const USAGE =
  'Usage: DATABASE_URL="..." npx tsx scripts/import-sheet.ts data.csv --family=<id>';

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error(USAGE);
  process.exit(1);
}

if (!familyArg || !Number.isInteger(FAMILY_ID) || FAMILY_ID <= 0) {
  console.error('ERROR: --family=<id> is required (a positive integer family id).');
  console.error('       List them with: SELECT id, name FROM family_calendar.families;');
  console.error(USAGE);
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.error(`ERROR: CSV file not found: ${CSV_PATH}`);
  console.error(USAGE);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV parsing (no external dep)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an English date string like "February 8, 1961" or "Aug. 3, 1971". */
function parseEnglishDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  // Remove trailing periods in month abbreviations
  const normalized = raw.replace(/\./g, '').trim();
  try {
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Infer which family branch a person belongs to from the surname in their name.
 *
 * Matches against the branch surnames configured in `src/lib/types.ts`
 * (FAMILY_BRANCHES) — so once you have set those to your own family's branch
 * names, this needs no editing. Anyone whose name matches none of them lands in
 * 'Other', which you can fix in the app afterwards.
 *
 * If your spreadsheet has an explicit branch column instead, pass it as the 5th
 * CSV column and it wins over this inference.
 */
function inferBranch(name: string): string {
  const n = name.toLowerCase();
  for (const branch of FAMILY_BRANCHES) {
    if (branch === 'Other') continue;
    if (n.includes(branch.toLowerCase())) return branch;
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

async function main() {
  // SSL for managed/remote Postgres; a local dev Postgres has none.
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL!);
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  // Everything runs on ONE connection with the tenant GUC set, because the data
  // tables are row-level-security scoped by `app.current_family`. Without this
  // the INSERTs are rejected by the policy's WITH CHECK and the SELECTs/DELETEs
  // silently see zero rows — RLS is FORCEd, so being the table owner does not
  // exempt you.
  const client = await pool.connect();
  await client.query("SELECT set_config('app.current_family', $1, false)", [String(FAMILY_ID)]);

  // Confirm the family actually exists before we delete anything. `families` is
  // one of the non-RLS tenancy tables, so this reads normally.
  const fam = await client.query<{ name: string }>(
    'SELECT name FROM family_calendar.families WHERE id = $1',
    [FAMILY_ID]
  );
  if (fam.rows.length === 0) {
    console.error(`ERROR: no family with id ${FAMILY_ID}.`);
    console.error('       List them with: SELECT id, name FROM family_calendar.families;');
    client.release();
    await pool.end();
    process.exit(1);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  // Skip header row
  const dataLines = lines.slice(1);

  console.log(`\nFamily Calendar Import`);
  console.log(`======================`);
  console.log(`CSV file: ${path.resolve(CSV_PATH)}`);
  console.log(`Family:   ${fam.rows[0].name} (id ${FAMILY_ID})`);
  console.log(`Data rows: ${dataLines.length}`);
  console.log('');

  // Clear this family's existing data. No WHERE family_id needed — RLS scopes
  // the DELETE to the current tenant, so other families cannot be touched.
  await client.query('DELETE FROM family_calendar.events');
  await client.query('DELETE FROM family_calendar.family_members');
  console.log('Cleared this family\'s existing data.\n');

  let imported = 0;
  let warnings = 0;

  for (const line of dataLines) {
    if (!line.trim()) continue;

    const cols = parseCsvLine(line);
    const [rawName, rawHebrewBirthday, rawEnglishBirthday, rawAnniversary, rawBranch] = cols;

    if (!rawName || !rawName.trim()) continue;

    const name = rawName.replace(/\\/g, '').trim();
    // An explicit branch column wins; otherwise infer it from the surname.
    const explicit = rawBranch?.trim();
    const branch =
      explicit && (FAMILY_BRANCHES as string[]).includes(explicit)
        ? explicit
        : inferBranch(name);

    // Insert family member
    const memberResult = await client.query(
      'INSERT INTO family_calendar.family_members (name, family_branch, family_id) VALUES ($1, $2, $3) RETURNING id',
      [name, branch, FAMILY_ID]
    );
    const memberId = memberResult.rows[0].id;

    // Parse birthday
    if (rawHebrewBirthday && rawHebrewBirthday.trim()) {
      try {
        const parsed = parseHebrewDateString(rawHebrewBirthday);
        const englishDate = parseEnglishDate(rawEnglishBirthday);
        await client.query(
          `INSERT INTO family_calendar.events
           (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year, original_english_date, note, family_id)
           VALUES ($1, 'birthday', $2, $3, $4, $5, $6, $7)`,
          [memberId, parsed.day, parsed.month, parsed.year ?? null, englishDate, parsed.note ?? null, FAMILY_ID]
        );
        console.log(`✓ ${name} — birthday: ${parsed.day} ${parsed.month}`);
        imported++;
      } catch (err) {
        console.warn(`⚠ ${name} — birthday parse FAILED: "${rawHebrewBirthday}"`);
        if (err instanceof Error) console.warn(`  Error: ${err.message}`);
        warnings++;
      }
    }

    // Parse anniversary
    // Anniversary column may contain "Hebrew ~ English" or "English ~ Hebrew" format
    if (rawAnniversary && rawAnniversary.trim()) {
      const annivParts = rawAnniversary.split(/~|\\~/).map(s => s.trim());

      // Try each part as the Hebrew date — some entries have English first (e.g. "January 23 ~ ח' שבט")
      let hebrewAnniv: string | null = null;
      let englishAnniv: string | null = null;
      for (let i = 0; i < annivParts.length; i++) {
        try {
          parseHebrewDateString(annivParts[i]); // test parse
          hebrewAnniv = annivParts[i];
          englishAnniv = annivParts.find((_, j) => j !== i) ?? null;
          break;
        } catch {
          continue;
        }
      }

      if (hebrewAnniv) {
        try {
          const parsed = parseHebrewDateString(hebrewAnniv);
          const englishDate = parseEnglishDate(englishAnniv ?? '');
          await client.query(
            `INSERT INTO family_calendar.events
             (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year, original_english_date, note, family_id)
             VALUES ($1, 'anniversary', $2, $3, $4, $5, $6, $7)`,
            [memberId, parsed.day, parsed.month, parsed.year ?? null, englishDate, parsed.note ?? null, FAMILY_ID]
          );
          console.log(`✓ ${name} — anniversary: ${parsed.day} ${parsed.month}`);
          imported++;
        } catch (err) {
          console.warn(`⚠ ${name} — anniversary parse FAILED: "${rawAnniversary}"`);
          if (err instanceof Error) console.warn(`  Error: ${err.message}`);
          warnings++;
        }
      }
    }
  }

  client.release();
  await pool.end();

  console.log('');
  console.log('======================');
  console.log(`Import complete: ${imported} events imported, ${warnings} warnings.`);
  if (warnings > 0) {
    console.log('');
    console.log('Review warnings above and add those entries manually through the web app.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
