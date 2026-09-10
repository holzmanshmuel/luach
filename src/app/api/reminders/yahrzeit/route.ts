import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { EventWithMember } from '@/lib/types';
import { hebrewToGregorianAll } from '@/lib/hebrew';
import { safeEqual } from '@/lib/safe-equal';
import { memberRecipients, memorialText } from '@/lib/digest';
import { configuredSiteUrl } from '@/lib/base-url';
import {
  clampLead,
  ymd,
  targetDateForLead,
  buildYahrzeitMessage,
} from '@/lib/yahrzeit-reminder';

export const dynamic = 'force-dynamic';

/**
 * Yahrzeit reminder feed, for the n8n + WhatsApp broadcast.
 *
 * A yahrzeit (and its memorial candle) begins at sundown the evening BEFORE the
 * Gregorian date the calendar shows for that Hebrew date. The reminder's advance
 * notice is configurable via the `lead` query param (days before the yahrzeit's
 * Gregorian date):
 *   - no param / `?lead=1` (default) → the candle is lit THIS evening (yahrzeit
 *     tomorrow) — the original eve-before behaviour, unchanged.
 *   - `?lead=7` → a "one week away" heads-up. The n8n cron can schedule an extra
 *     daily call with a larger lead alongside the nightly candle reminder.
 *
 * Token-gated with N8N_TOKEN. Returns a ready-to-send message plus the recipient
 * list (family members with notifications enabled, plus the DIGEST_RECIPIENTS
 * env list). Same recipient model as the weekly digest.
 */

interface MemberEvent extends EventWithMember {
  phone_e164: string | null;
  notifications_enabled: boolean;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(request: NextRequest) {
  const expected = process.env.N8N_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'N8N_TOKEN not configured on server.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const token = bearer ?? request.nextUrl.searchParams.get('token');
  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // The reminder text carries a link that recipients open on their own phones,
  // so it has to name THIS deployment. Refuse rather than guess — checked after
  // the token so the config state isn't reportable to anonymous callers.
  const siteUrl = configuredSiteUrl();
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'NEXTAUTH_URL not configured on server. Set it to this deployment’s public URL (e.g. https://calendar.example.com) — the reminder links to it.' },
      { status: 500 }
    );
  }

  const familyParam = request.nextUrl.searchParams.get('family');
  const familyId = familyParam ? Number(familyParam) : NaN;
  if (!familyParam || !Number.isInteger(familyId) || familyId <= 0) {
    return NextResponse.json({ error: 'family parameter required' }, { status: 400 });
  }

  const families = await systemQuery<{ id: number }>(
    'SELECT id FROM family_calendar.families WHERE id=$1',
    [familyId]
  );
  if (families.length === 0) {
    return NextResponse.json({ error: 'family not found' }, { status: 404 });
  }

  // Advance-notice lead time (days before the yahrzeit date); default 1 = eve-before.
  const lead = clampLead(request.nextUrl.searchParams.get('lead'));

  return runWithTenant(familyId, async () => {
    // The reminder targets a yahrzeit `lead` days from today (lead=1 → tomorrow,
    // i.e. the candle is lit this evening).
    const today = startOfToday();
    const target = targetDateForLead(today, lead);
    const targetKey = ymd(target);

    const rows = await query<MemberEvent>(`
      SELECT e.*, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname, fm.photo_url,
             fm.phone_e164, fm.notifications_enabled
      FROM family_calendar.events e
      JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
      WHERE e.event_type = 'yahrtzeit'
    `);

    const lines: string[] = [];
    const seen = new Set<string>();
    // Check this Hebrew-year and next so a turn-of-year yahrzeit still resolves.
    const years = [today.getFullYear(), today.getFullYear() + 1];

    for (const row of rows) {
      for (const y of years) {
        // All occurrences in the civil year (a Hebrew date can fall twice near the
        // Dec/Jan boundary), so a late-December yahrzeit candle isn't missed.
        for (const d of hebrewToGregorianAll(row.hebrew_day, row.hebrew_month, y)) {
          if (ymd(d) !== targetKey) continue;
          if (seen.has(row.id.toString())) continue;
          seen.add(row.id.toString());
          // memorialText() appends the Hebrew-year count (correct across Jan 1)
          // and sanitizes the user-controlled name, so a smuggled newline can't
          // inject extra spoofed lines into the broadcast message. Shared with
          // /api/digest/daily's "Tonight begins" block — same wording.
          lines.push(`🕯️ ${memorialText(row, d)}`);
        }
      }
    }

    const message = buildYahrzeitMessage(lines, target, lead, siteUrl);

    // The DIGEST_RECIPIENTS env list is deployment-wide, so on a multi-family
    // instance it puts the operator on EVERY family's reminder. Kept here because
    // self-hosters' running workflows rely on it; /api/digest/daily omits it.
    const envRecipients = (process.env.DIGEST_RECIPIENTS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const recipients = [...new Set([...memberRecipients(rows), ...envRecipients])];

    return NextResponse.json({
      date: targetKey,
      lead,
      has_content: lines.length > 0,
      count: lines.length,
      message,
      recipients,
    });
  });
}
