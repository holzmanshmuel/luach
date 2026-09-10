import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { Gathering } from '@/lib/types';
import { safeEqual } from '@/lib/safe-equal';
import { configuredSiteUrl } from '@/lib/base-url';
import { memberRecipients, type DigestEventRow } from '@/lib/digest';
import { buildDailyDigest } from '@/lib/digest-daily';

export const dynamic = 'force-dynamic';

/**
 * The ONE morning digest, for the n8n + WhatsApp broadcast — today's events, the
 * yahrzeits that begin at nightfall tonight, and (Sundays only) the rest of the
 * week. It replaces the pair of crons that called `/api/digest/week` on Sunday
 * evenings and `/api/reminders/yahrzeit` nightly; both of those routes stay live
 * and unchanged for self-hosters whose workflows already call them.
 *
 * Same auth, guards and tenant scoping as the other N8N_TOKEN feeds: bearer (or
 * `?token=`) compared against N8N_TOKEN in constant time, a mandatory
 * `?family=<id>`, and every read inside `runWithTenant` so row-level security
 * scopes it to that one family.
 *
 * Returns a ready-to-send `message` plus `recipients`. `has_content` is the gate:
 * false means send nothing today.
 *
 * RECIPIENTS DIFFER FROM THE LEGACY FEEDS, DELIBERATELY. This route uses ONLY
 * family members who opted in (phone number + notifications enabled). It does
 * NOT read `DIGEST_RECIPIENTS`, because that env list is deployment-wide: on a
 * multi-family instance it silently subscribes the operator to every family's
 * private dates. Whoever wants the digest joins the family as a member with a
 * phone number. See SETUP-WHATSAPP.md.
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

  return runWithTenant(familyId, async () => {
    const [events, gatherings] = await Promise.all([
      // Every event, not only those of members with notifications enabled: that
      // flag governs who RECEIVES the digest, not whose birthday is in it — same
      // as /api/digest/week.
      query<DigestEventRow>(`
        SELECT e.*, fm.name, fm.last_name, fm.name_he, fm.family_branch, fm.nickname,
               fm.photo_url, fm.phone_e164, fm.notifications_enabled
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

    const digest = buildDailyDigest({ events, gatherings, siteUrl });

    return NextResponse.json({
      ...digest,
      recipients: memberRecipients(events),
    });
  });
}
