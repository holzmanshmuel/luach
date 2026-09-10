'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getSession, requireAdmin } from '@/lib/auth';
import { runWithTenant } from '@/lib/tenant';
import { auditEvent, type AuditableEvent } from '@/lib/date-consistency';

/**
 * The two one-click corrections offered by the date-check page.
 *
 * ── WHY THE CLIENT SENDS NO DATES ──
 * Both actions take only an event id and a direction. The corrected value is
 * re-derived HERE, from the row as it stands in the database, by re-running the
 * same audit the page rendered. The browser therefore cannot post a date at all,
 * so a stale page, a doctored form or a double-submit can never write a value the
 * server did not itself compute from the family's own data.
 *
 * Both are tenant-scoped: requireAdmin() establishes the caller's family context
 * before query() runs, so the WHERE clauses below cannot reach another family's
 * rows even with a guessed id — RLS drops them.
 */

/**
 * Run `fn` as the verified owner of the caller's family, with tenant context that
 * actually survives into it.
 *
 * ── WHY NOT JUST `await requireAdmin()` ──
 * `requireAdmin()` ends by calling `enterTenant()`, which is enough for a PAGE
 * (a React render memoizes the request-scoped holder, so the value survives the
 * guard resolving back to its caller). It is NOT enough inside a Server Action:
 * there, `React.cache()` does not memoize the holder and `enterWith()` is lost
 * when the awaited guard resolves — so the very next `query()` throws
 * "No tenant context: query() called without an active family."
 *
 * That asymmetry is why every page rendered perfectly while every edit in the app
 * failed. `runWithTenant()` uses `AsyncLocalStorage.run()`, which wraps the
 * callback unambiguously, so the context is present for everything inside it.
 */
async function asOwner<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: 'Admin access required.' };
  }
  const { familyId } = await getSession();
  if (!familyId) return { error: 'Admin access required.' };
  return runWithTenant(familyId, fn);
}

/** Load one event in the caller's family, shaped for the audit. Null if not theirs. */
async function loadAuditableEvent(eventId: number): Promise<AuditableEvent | null> {
  const rows = await query<AuditableEvent>(
    `SELECT e.id,
            m.name AS person_name,
            e.event_type,
            e.hebrew_day,
            e.hebrew_month,
            e.original_english_date::text AS original_english_date
       FROM family_calendar.events e
       JOIN family_calendar.family_members m ON m.id = e.family_member_id
      WHERE e.id = $1`,
    [eventId]
  );
  return rows[0] ?? null;
}

/**
 * Trust the Hebrew date: rewrite the English date to the civil date that Hebrew
 * date actually fell on. This is the common case — the Hebrew date came from a
 * family memory and the English one from a mistyped spreadsheet cell.
 */
export async function trustHebrewDateAction(eventId: number): Promise<{ error?: string }> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Bad event id.' };
  return asOwner(async () => {
  const event = await loadAuditableEvent(eventId);
  if (!event) return { error: 'Event not found.' };

  const finding = auditEvent(event);
  if (finding.verdict !== 'mismatch' || !finding.expected_english) {
    // Nothing to correct — most likely someone else already fixed it, or the page
    // is stale. Say so rather than writing a no-op.
    return { error: 'That row no longer needs correcting — reload the page.' };
  }

  const newYear = Number(finding.expected_english.slice(0, 4));
  await query(
    `UPDATE family_calendar.events
        SET original_english_date = $1,
            gregorian_year = CASE WHEN gregorian_year IS NULL THEN NULL ELSE $2 END,
            updated_at = NOW()
      WHERE id = $3`,
    [finding.expected_english, newYear, eventId]
  );

  revalidatePath('/');
  revalidatePath('/tree');
  revalidatePath('/timeline');
  revalidatePath('/admin/dates');
  return {};
  });
}

/**
 * Trust the English date: rewrite the recurring Hebrew day/month to the Hebrew
 * date that civil date actually fell on. For families whose civil dates come off
 * a birth certificate and whose Hebrew dates were worked out later by hand.
 */
export async function trustEnglishDateAction(eventId: number): Promise<{ error?: string }> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Bad event id.' };
  return asOwner(async () => {
  const event = await loadAuditableEvent(eventId);
  if (!event) return { error: 'Event not found.' };

  const finding = auditEvent(event);
  if (finding.verdict !== 'mismatch' || !finding.english_falls_on) {
    return { error: 'That row no longer needs correcting — reload the page.' };
  }

  // english_falls_on is "<day> <Month> <hebrewYear>" — rebuild the parts rather
  // than re-parsing the display string, so the stored value can never inherit a
  // formatting change.
  const parts = finding.english_falls_on.split(' ');
  const day = Number(parts[0]);
  const month = parts.slice(1, -1).join(' ');
  const hebrewYear = Number(parts[parts.length - 1]);
  if (!Number.isInteger(day) || !month || !Number.isInteger(hebrewYear)) {
    return { error: 'Could not work out the Hebrew date — edit this one by hand.' };
  }

  await query(
    `UPDATE family_calendar.events
        SET hebrew_day = $1,
            hebrew_month = $2,
            hebrew_year = CASE WHEN hebrew_year IS NULL THEN NULL ELSE $3 END,
            updated_at = NOW()
      WHERE id = $4`,
    [day, month, hebrewYear, eventId]
  );

  revalidatePath('/');
  revalidatePath('/tree');
  revalidatePath('/timeline');
  revalidatePath('/admin/dates');
  return {};
  });
}
