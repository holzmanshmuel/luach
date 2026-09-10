/**
 * Date-consistency audit — does a row's Hebrew date agree with its English date?
 *
 * ── WHY THIS EXISTS ──
 * An event carries TWO independently-stored dates: the recurring Hebrew day/month
 * (`hebrew_day` + `hebrew_month`) and the original Gregorian date
 * (`original_english_date`). The calendar renders BOTH — the Hebrew occurrence on
 * the day the Hebrew date falls this year, and the English occurrence on the same
 * month/day every year. Nothing ever checked that the two describe the same day.
 *
 * When a row is entered through the app they agree by construction (the Add/Edit
 * form derives the Hebrew date FROM the English one). But a row IMPORTED from a
 * spreadsheet has two hand-typed columns, and a typo in either survives forever
 * and silently: the Hebrew birthday shows on the right day and the English
 * birthday shows on the wrong one, or vice versa. The case that motivated this: a
 * spreadsheet cell holding a two-digit day lost its leading digit, so "the 17th"
 * was typed as "the 7th". Both halves parsed cleanly, the Hebrew date stayed
 * correct, and the calendar showed the English birthday ten days early for years.
 *
 * ── HOW THE CHECK WORKS ──
 * Rather than compare month NAMES (which drags in the whole Adar-in-a-leap-year
 * question), we project the stored Hebrew date forward with the app's OWN
 * recurrence rule — {@link hebrewToGregorianAll}, the same function the calendar
 * grid uses — into the civil year of the stored English date, and ask whether it
 * lands on that date. The gap, in days, is the finding. This means the audit
 * agrees with what a viewer actually sees by definition.
 *
 * A one-day gap is NOT an error: the Hebrew day begins at nightfall, so a baby
 * born on the evening of the 16th has a civil birthday of the 16th and a Hebrew
 * birthday belonging to the 17th. Only a gap of two days or more indicates a typo.
 */

import { exactGregorianToHebrew, formatHebrewDate, hebrewToGregorianAll } from './hebrew';

/** A gap of this many days or fewer is the ordinary nightfall offset, not an error. */
export const NIGHTFALL_TOLERANCE_DAYS = 1;

/** The columns the audit needs. Deliberately a subset, so it is trivial to test. */
export interface AuditableEvent {
  id: number;
  /** Whose event it is, for the report. */
  person_name: string;
  event_type: string;
  hebrew_day: number;
  hebrew_month: string;
  /** `YYYY-MM-DD`, or null when the family never recorded a civil date. */
  original_english_date: string | null;
}

export type Verdict =
  /** The two dates describe the same day. Nothing to do. */
  | 'ok'
  /** One day apart — the normal after-nightfall birth. Nothing to do. */
  | 'nightfall'
  /** Two or more days apart. One of the two dates is wrong. */
  | 'mismatch'
  /**
   * Same day of the month, but a different Adar: the event falls in one Adar of a
   * leap year and the stored month resolves to the other. NOT a typo — a question
   * of which Adar a family observes in a leap year — so it must never be offered
   * the same blunt "one of these is wrong" correction. See {@link isAdarMonth}.
   */
  | 'adar_convention'
  /** No English date stored, so there is nothing to cross-check against. */
  | 'no_english'
  /** The English date is unparseable, or the Hebrew date does not convert. */
  | 'unconvertible';

/** Is this stored month name one of the three Adars? */
export function isAdarMonth(month: string): boolean {
  return month === 'Adar' || month === 'Adar I' || month === 'Adar II';
}

export interface Finding {
  id: number;
  person_name: string;
  event_type: string;
  verdict: Verdict;
  /** e.g. `"12 Sivan"` — the stored recurring Hebrew date. */
  stored_hebrew: string;
  /** e.g. `"1978-06-07"` — the stored civil date, or null. */
  stored_english: string | null;
  /**
   * The Hebrew date the stored English date ACTUALLY falls on, e.g.
   * `"2 Sivan 5738"`. This is the line that makes a typo obvious to a human.
   */
  english_falls_on: string | null;
  /**
   * What the English date WOULD be if the Hebrew date is the correct one —
   * the suggested correction. `YYYY-MM-DD`, or null when unconvertible.
   */
  expected_english: string | null;
  /**
   * Signed gap in days: stored English date minus expected English date.
   * Negative means the stored English date is earlier than the Hebrew date implies.
   */
  offset_days: number | null;
}

/** Strict `YYYY-MM-DD` parse into a LOCAL date. */
function parseYmdLocal(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject impossible dates ("2020-02-30") rather than letting Date roll them over.
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/**
 * Format a local Date as `YYYY-MM-DD`.
 *
 * Built from the local getters on purpose. `toISOString()` would render the date
 * in UTC and shift it a day west of Greenwich — the exact bug that once wrote 38
 * birthdays into this database one day early.
 */
function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days between two local dates, ignoring any time component. */
function dayGap(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((da - db) / 86_400_000);
}

/**
 * Where the stored Hebrew date lands nearest to a given civil date.
 *
 * Probes the civil year of the target and its two neighbours, because a Hebrew
 * date near the Tishrei boundary can fall in either of two civil years — and a
 * late-December birth compared only against its own civil year would otherwise
 * report an alarming ~350-day gap for a perfectly correct row.
 */
function nearestHebrewOccurrence(
  day: number,
  month: string,
  target: Date
): { date: Date; offsetDays: number } | null {
  const year = target.getFullYear();
  const candidates: Date[] = [];
  for (const y of [year - 1, year, year + 1]) {
    candidates.push(...hebrewToGregorianAll(day, month, y));
  }
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestGap = dayGap(target, best);
  for (const c of candidates.slice(1)) {
    const gap = dayGap(target, c);
    if (Math.abs(gap) < Math.abs(bestGap)) {
      best = c;
      bestGap = gap;
    }
  }
  return { date: best, offsetDays: bestGap };
}

/** Audit one event. Pure — no clock, no database, no locale. */
export function auditEvent(event: AuditableEvent): Finding {
  const storedHebrew = formatHebrewDate(event.hebrew_day, event.hebrew_month);
  const base = {
    id: event.id,
    person_name: event.person_name,
    event_type: event.event_type,
    stored_hebrew: storedHebrew,
    stored_english: event.original_english_date,
  };

  if (!event.original_english_date) {
    return {
      ...base,
      verdict: 'no_english',
      english_falls_on: null,
      expected_english: null,
      offset_days: null,
    };
  }

  const parsed = parseYmdLocal(event.original_english_date);
  if (!parsed) {
    return {
      ...base,
      verdict: 'unconvertible',
      english_falls_on: null,
      expected_english: null,
      offset_days: null,
    };
  }

  const englishAsHebrew = exactGregorianToHebrew(parsed.m, parsed.d, parsed.y);
  const englishFallsOn = englishAsHebrew
    ? formatHebrewDate(englishAsHebrew.day, englishAsHebrew.month, englishAsHebrew.hebrewYear)
    : null;

  const target = new Date(parsed.y, parsed.m - 1, parsed.d);
  const occurrence = nearestHebrewOccurrence(event.hebrew_day, event.hebrew_month, target);
  if (!occurrence) {
    return {
      ...base,
      verdict: 'unconvertible',
      english_falls_on: englishFallsOn,
      expected_english: null,
      offset_days: null,
    };
  }

  const offset = occurrence.offsetDays;

  // A leap year has two Adars, and which one an Adar occasion recurs in is a
  // question of custom, not of arithmetic — `hebrewToGregorianAll` applies this
  // app's choice (a generic 'Adar' recurs in Adar II). So a row born on 1 Adar I
  // and stored as plain 'Adar' will ALWAYS read ~30 days out, forever, without
  // anything being mistyped. Calling that a typo would be wrong, and offering the
  // usual one-click "fix" would quietly move when the family observes the day.
  // Recognise it by its signature: the same day of the month, both months Adar.
  const sameDayDifferentAdar =
    englishAsHebrew !== null &&
    englishAsHebrew.day === event.hebrew_day &&
    isAdarMonth(event.hebrew_month) &&
    isAdarMonth(englishAsHebrew.month) &&
    englishAsHebrew.month !== event.hebrew_month;

  const verdict: Verdict =
    offset === 0
      ? 'ok'
      : Math.abs(offset) <= NIGHTFALL_TOLERANCE_DAYS
        ? 'nightfall'
        : sameDayDifferentAdar
          ? 'adar_convention'
          : 'mismatch';

  return {
    ...base,
    verdict,
    english_falls_on: englishFallsOn,
    expected_english: ymdLocal(occurrence.date),
    offset_days: offset,
  };
}

export interface AuditSummary {
  total: number;
  ok: number;
  nightfall: number;
  mismatch: number;
  adar_convention: number;
  no_english: number;
  unconvertible: number;
}

export interface AuditReport {
  summary: AuditSummary;
  /**
   * Rows where one of the two dates is genuinely wrong — mismatches and
   * unconvertible rows — worst gap first. Clean rows are counted, never listed.
   */
  problems: Finding[];
  /**
   * Adar-convention rows, listed SEPARATELY because they need a decision about
   * custom rather than a correction. Mixing them into `problems` would invite
   * someone to "fix" a date that is not broken.
   */
  adarChoices: Finding[];
}

/** Audit every event, worst gap first. Pure. */
export function auditEvents(events: readonly AuditableEvent[]): AuditReport {
  const findings = events.map(auditEvent);
  const summary: AuditSummary = {
    total: findings.length,
    ok: 0,
    nightfall: 0,
    mismatch: 0,
    adar_convention: 0,
    no_english: 0,
    unconvertible: 0,
  };
  for (const f of findings) summary[f.verdict] += 1;

  const byWorstGap = (a: Finding, b: Finding) =>
    Math.abs(b.offset_days ?? 0) - Math.abs(a.offset_days ?? 0);

  return {
    summary,
    problems: findings
      .filter(f => f.verdict === 'mismatch' || f.verdict === 'unconvertible')
      .sort(byWorstGap),
    adarChoices: findings.filter(f => f.verdict === 'adar_convention').sort(byWorstGap),
  };
}
