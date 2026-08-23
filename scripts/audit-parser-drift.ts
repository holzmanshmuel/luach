/**
 * Report which rows of a source CSV parse differently under parse-hebrew-date
 * 0.2.0 than they did under 0.1.0.
 *
 * WHY THIS EXISTS
 *
 * 0.2.0 fixed four dating bugs (see that package's CHANGELOG). Rows imported
 * before the bump were written by the buggy parser, and the importer does not
 * store the original Hebrew string — only the parsed day/month/year — so a
 * wrong row cannot be detected, let alone corrected, from the database alone.
 * The source spreadsheet is the only place the truth still exists.
 *
 * This script is READ-ONLY. It touches neither the database nor the CSV. It
 * tells you whether re-importing would actually change anything, and exactly
 * which people are affected, so that decision is made with the list in hand.
 *
 * Usage:
 *   npx tsx scripts/audit-parser-drift.ts data.csv
 *
 * If it reports no drift, the stored rows are already correct and no
 * re-import is needed. If it reports drift, the fix is to re-run
 * scripts/import-sheet.ts against the same CSV — that script clears and
 * rewrites the family, so it is the whole correction, not a patch.
 *
 * Requires the devDependency alias `phd-old` (parse-hebrew-date@0.1.0). Both
 * it and this script can be deleted once the audit is settled.
 */

import fs from 'fs';
import { parseHebrewDate as parseNew } from 'parse-hebrew-date';
import { parseHebrewDate as parseOld } from 'phd-old';
import { splitAnniversaryCell } from '../src/lib/sheet-import';

const CSV_PATH = process.argv[2] ?? 'data.csv';

if (!fs.existsSync(CSV_PATH)) {
  console.error(`No such file: ${CSV_PATH}`);
  console.error('Usage: npx tsx scripts/audit-parser-drift.ts <csv>');
  process.exit(1);
}

/** Minimal CSV row splitter: handles quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

type Parsed = ReturnType<typeof parseNew>;

/** A one-line rendering, so two results can be compared and printed. */
function render(p: Parsed): string {
  if (!p) return 'UNPARSEABLE';
  return [p.day, p.month, p.year ?? '—'].join(' ');
}

/** Which fix explains a difference — for grouping the summary. */
function classify(before: Parsed, after: Parsed): string {
  if (!before || !after) return 'parses now / stopped parsing';
  if (before.year !== after.year && before.month === after.month && before.day === after.day) {
    return 'year corrected (sofit letter)';
  }
  if (before.day === 1 && after.day === 30) return 'impossible date no longer rolled forward';
  if (before.month !== after.month) return 'Adar resolved from the words written';
  return 'other';
}

const lines = fs
  .readFileSync(CSV_PATH, 'utf8')
  .split(/\r?\n/)
  .filter(l => l.trim().length > 0)
  .slice(1); // header

interface Drift {
  name: string;
  column: string;
  raw: string;
  before: string;
  after: string;
  reason: string;
}

const drifts: Drift[] = [];
let cellsChecked = 0;

for (const line of lines) {
  const cols = splitCsvLine(line);
  const name = (cols[0] ?? '').split('~')[0].trim() || '(unnamed row)';

  const cells: Array<[string, string | undefined]> = [
    ['Hebrew Birthday', cols[1]],
    ['Anniversary', splitAnniversaryCell(cols[3]).hebrew ?? undefined],
  ];

  for (const [column, raw] of cells) {
    if (!raw || !raw.trim()) continue;
    cellsChecked++;
    const before = parseOld(raw);
    const after = parseNew(raw);
    if (render(before) === render(after)) continue;
    drifts.push({
      name,
      column,
      raw,
      before: render(before),
      after: render(after),
      reason: classify(before, after),
    });
  }
}

console.log(`Rows read:      ${lines.length}`);
console.log(`Hebrew cells:   ${cellsChecked}`);
console.log(`Cells changed:  ${drifts.length}`);
console.log('');

if (drifts.length === 0) {
  console.log('No drift. Every Hebrew date in this CSV parses identically under');
  console.log('0.1.0 and 0.2.0, so the rows already in the database are correct');
  console.log('and no re-import is needed.');
  process.exit(0);
}

const byReason = new Map<string, Drift[]>();
for (const d of drifts) {
  const list = byReason.get(d.reason) ?? [];
  list.push(d);
  byReason.set(d.reason, list);
}

for (const [reason, list] of byReason) {
  console.log(`── ${reason} (${list.length}) ${'─'.repeat(Math.max(0, 50 - reason.length))}`);
  for (const d of list) {
    console.log(`  ${d.name} — ${d.column}`);
    console.log(`    "${d.raw}"`);
    console.log(`    stored now: ${d.before}`);
    console.log(`    should be:  ${d.after}`);
  }
  console.log('');
}

console.log('These rows are wrong in the database. To correct them, re-run the');
console.log('importer against this same CSV — it clears and rewrites the family:');
console.log('');
console.log(`  DATABASE_URL="..." npx tsx scripts/import-sheet.ts ${CSV_PATH} --family=<id>`);
console.log('');
console.log('Anything added or edited by hand in the app since the last import');
console.log('will be lost by that, so check for such edits first.');
