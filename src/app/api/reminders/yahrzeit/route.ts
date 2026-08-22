import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { EventWithMember } from '@/lib/types';
import { hebrewToGregorianAll, yearsSince } from '@/lib/hebrew';
import { safeEqual } from '@/lib/safe-equal';
import { fullName } from '@/lib/names';
import { oneLine } from '@/lib/text';
import { ordinal } from '@/lib/event-phrase';
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
          const n = yearsSince(d, row); // Hebrew-year count (correct across Jan 1)
          const yearsLabel = n && n > 0 ? ` (${ordinal(n)} yahrzeit)` : '';
          // Sanitize the user-controlled name so a smuggled newline can't inject
          // extra spoofed lines into the broadcast message.
          lines.push(`🕯️ ${oneLine(fullName(row))}${yearsLabel}`);
        }
      }
    }

    const siteUrl = process.env.NEXTAUTH_URL || 'https://family-calendar.holzman-ai.com';
    const message = buildYahrzeitMessage(lines, target, lead, siteUrl);

    const envRecipients = (process.env.DIGEST_RECIPIENTS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const recipients = [
      ...new Set([
        ...rows
          .filter(r => r.notifications_enabled && r.phone_e164 && r.phone_e164.trim())
          .map(r => r.phone_e164!.trim()),
        ...envRecipients,
      ]),
    ];

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
