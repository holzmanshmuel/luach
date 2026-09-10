import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant, isValidFamilyId } from '@/lib/tenant';
import { Gathering } from '@/lib/types';
import { safeEqual } from '@/lib/safe-equal';
import { configuredSiteUrl } from '@/lib/base-url';
import { collectItems, memberRecipients, type DigestEventRow } from '@/lib/digest';
import { addDays, civilDayInZone, fmtShortDay, ymd } from '@/lib/zoned-day';

export const dynamic = 'force-dynamic';

/**
 * Weekly "This week in the family" digest, for the n8n + WhatsApp broadcast.
 * Returns a ready-to-send message plus the recipient list (every family member
 * with a phone number and notifications enabled). Token-gated with N8N_TOKEN.
 *
 * Designed to be the single source of truth: n8n only schedules, fetches this,
 * and fans the message out to `recipients`. Adding more family phone numbers in
 * the app automatically widens the audience with no workflow change.
 *
 * The event shaping, line formatting and recipient list live in `lib/digest.ts`,
 * shared with `/api/digest/daily` — the newer single-morning-job feed — so the
 * two speak with one voice. The output of THIS route is unchanged and live n8n
 * workflows depend on it: keep it byte-identical.
 */

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

  // The digest text carries a link that recipients open on their own phones, so
  // it has to name THIS deployment. Refuse rather than guess — checked after the
  // token so the config state isn't reportable to anonymous callers.
  const siteUrl = configuredSiteUrl();
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'NEXTAUTH_URL not configured on server. Set it to this deployment’s public URL (e.g. https://calendar.example.com) — the digest links to it.' },
      { status: 500 }
    );
  }

  const familyParam = request.nextUrl.searchParams.get('family');
  const familyId = familyParam ? Number(familyParam) : NaN;
  if (!familyParam || !isValidFamilyId(familyId)) {
    return NextResponse.json({ error: 'family parameter required' }, { status: 400 });
  }

  const families = await systemQuery<{ id: number }>(
    'SELECT id FROM family_calendar.families WHERE id=$1',
    [familyId]
  );
  if (families.length === 0) {
    return NextResponse.json({ error: 'family not found' }, { status: 404 });
  }

  return runWithTenant(familyId, async () => {
    // "Today" is the civil day it is in the DEPLOYMENT's zone, on a local-NOON
    // carrier — the shared convention in zoned-day.ts. The local-midnight
    // startOfToday() this replaces could land on the previous day in a zone that
    // moves its clock at 00:00, silently shifting the whole window. Every label
    // and key below reads local Y/M/D, so the message is byte-identical.
    const today = civilDayInZone();
    const end = addDays(today, 7); // next 7 days inclusive of today

    const [rows, gatherings] = await Promise.all([
      query<DigestEventRow>(`
        SELECT e.*, fm.name, fm.last_name, fm.family_branch, fm.nickname, fm.photo_url,
               fm.phone_e164, fm.notifications_enabled
        FROM family_calendar.events e
        JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
      `),
      query<Gathering>(
        `SELECT id, title, kind, to_char(gather_date, 'YYYY-MM-DD') AS gather_date,
                to_char(gather_time, 'HH24:MI') AS gather_time, location, description,
                created_at, updated_at
         FROM family_calendar.gatherings`
      ),
    ]);

    // One line per person+occasion in the week (a birthday whose Hebrew and
    // English occurrences both land in the window is listed once), Hebrew and
    // fixed-Gregorian occurrences both considered, user-editable text collapsed
    // to a single line — all of it in collectItems().
    const items = collectItems({
      events: rows,
      gatherings,
      from: today,
      to: end,
      years: [today.getFullYear(), today.getFullYear() + 1],
    });

    const rangeLabel = `${fmtShortDay(today)} – ${fmtShortDay(end)}`;
    let message: string;
    if (items.length === 0) {
      message = `🗓️ *This week in the family* (${rangeLabel})\n\nNothing on the calendar this week. ${siteUrl}`;
    } else {
      const lines = items.map(it => `${it.icon} ${fmtShortDay(it.on)} — ${it.text}`);
      message = `🗓️ *This week in the family* (${rangeLabel})\n\n${lines.join('\n')}\n\nSee it all 👉 ${siteUrl}`;
    }

    // Recipients come from two sources, de-duplicated:
    //  1. Family members with a phone number + notifications enabled (managed in
    //     the app's Edit-person form) — the self-service path for relatives.
    //  2. The DIGEST_RECIPIENTS env list (comma-separated) — for people who should
    //     get the digest but aren't members of this tree (e.g. the maintainer).
    //
    // Source 2 is deployment-wide, so on a multi-family instance it puts the
    // operator on EVERY family's digest. Kept here because self-hosters' running
    // workflows rely on it; the newer /api/digest/daily deliberately omits it.
    const envRecipients = (process.env.DIGEST_RECIPIENTS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const recipients = [...new Set([...memberRecipients(rows), ...envRecipients])];

    return NextResponse.json({
      range: { start: ymd(today), end: ymd(end) },
      has_content: items.length > 0,
      count: items.length,
      message,
      recipients,
    });
  });
}
