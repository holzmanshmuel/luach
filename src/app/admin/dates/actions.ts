'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { withAdminOrError } from '@/lib/auth';
import { setEventEnglishDate, setEventHebrewDate } from '@/lib/date-corrections';
import { auditEvent, type AuditableEvent } from '@/lib/date-consistency';
import { keyedDenial } from '@/lib/action-errors';
import type { TMessage } from '@/lib/translations';

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
 * Both are tenant-scoped: withAdminOrError() verifies the owner live and runs the
 * body inside the caller's family context, so the WHERE clauses below cannot reach
 * another family's rows even with a guessed id — RLS drops them.
 *
 * `withAdminOrError` is the shared helper in lib/auth.ts; the local `asOwner`
 * these two actions used to carry was its first, one-file draft. Every Server
 * Action in the app now goes through the same wrappers, for the reason documented
 * there: a bare `await requireAdmin()` leaves the next `query()` with no tenant.
 */

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

/*
 * ── ERRORS ARE KEYS, NOT SENTENCES ──
 * Both actions return a translation key (`TMessage`), never English text: the page
 * is bilingual, and the client renders the key in the owner's language. A malformed
 * id and a row outside this family read the same to the owner — "that event was not
 * found" — so both use the calendar's existing `err.event_not_found`.
 */
type DateFixResult = { error?: TMessage };

const EVENT_NOT_FOUND: TMessage = { key: 'err.event_not_found' };
const ROW_IS_STALE: TMessage = { key: 'dates.err.stale' };

/**
 * Trust the Hebrew date: rewrite the English date to the civil date that Hebrew
 * date actually fell on. This is the common case — the Hebrew date came from a
 * family memory and the English one from a mistyped spreadsheet cell.
 */
export async function trustHebrewDateAction(eventId: number): Promise<DateFixResult> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: EVENT_NOT_FOUND };
  return keyedDenial(await withAdminOrError(async (): Promise<DateFixResult> => {
    const event = await loadAuditableEvent(eventId);
    if (!event) return { error: EVENT_NOT_FOUND };

    const finding = auditEvent(event);
    if (finding.verdict !== 'mismatch' || !finding.expected_english) {
      // Nothing to correct — most likely someone else already fixed it, or the page
      // is stale. Say so rather than writing a no-op.
      return { error: ROW_IS_STALE };
    }

    await setEventEnglishDate(eventId, finding.expected_english);

    revalidatePath('/');
    revalidatePath('/tree');
    revalidatePath('/timeline');
    revalidatePath('/admin/dates');
    return {};
  }));
}

/**
 * Trust the English date: rewrite the recurring Hebrew day/month to the Hebrew
 * date that civil date actually fell on. For families whose civil dates come off
 * a birth certificate and whose Hebrew dates were worked out later by hand.
 */
export async function trustEnglishDateAction(eventId: number): Promise<DateFixResult> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: EVENT_NOT_FOUND };
  return keyedDenial(await withAdminOrError(async (): Promise<DateFixResult> => {
    const event = await loadAuditableEvent(eventId);
    if (!event) return { error: EVENT_NOT_FOUND };

    const finding = auditEvent(event);
    if (finding.verdict !== 'mismatch' || !finding.english_falls_on) {
      return { error: ROW_IS_STALE };
    }

    // english_falls_on is "<day> <Month> <hebrewYear>" — rebuild the parts rather
    // than re-parsing the display string, so the stored value can never inherit a
    // formatting change.
    const parts = finding.english_falls_on.split(' ');
    const day = Number(parts[0]);
    const month = parts.slice(1, -1).join(' ');
    const hebrewYear = Number(parts[parts.length - 1]);
    if (!Number.isInteger(day) || !month || !Number.isInteger(hebrewYear)) {
      return { error: { key: 'dates.err.no_hebrew' } };
    }

    await setEventHebrewDate(eventId, day, month, hebrewYear);

    revalidatePath('/');
    revalidatePath('/tree');
    revalidatePath('/timeline');
    revalidatePath('/admin/dates');
    return {};
  }));
}
