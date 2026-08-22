import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { EventWithMember, Gathering, gatheringIcon } from '@/lib/types';
import { hebrewToGregorianAll, yearsSince } from '@/lib/hebrew';
import { safeEqual } from '@/lib/safe-equal';
import { fullName } from '@/lib/names';
import { oneLine } from '@/lib/text';

export const dynamic = 'force-dynamic';

/**
 * Weekly "This week in the family" digest, for the n8n + WhatsApp broadcast.
 * Returns a ready-to-send message plus the recipient list (every family member
 * with a phone number and notifications enabled). Token-gated with N8N_TOKEN.
 *
 * Designed to be the single source of truth: n8n only schedules, fetches this,
 * and fans the message out to `recipients`. Adding more family phone numbers in
 * the app automatically widens the audience with no workflow change.
 */

interface MemberEvent extends EventWithMember {
  phone_e164: string | null;
  notifications_enabled: boolean;
}

interface DigestItem {
  date: Date;
  icon: string;
  text: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Local YYYY-MM-DD (toISOString would shift by the timezone offset). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ordinal(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function solarInYear(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  d.setHours(0, 0, 0, 0);
  if (d.getMonth() !== month) { const last = new Date(year, month + 1, 0); last.setHours(0, 0, 0, 0); return last; }
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

  return runWithTenant(familyId, async () => {
    const today = startOfToday();
    const end = new Date(today);
    end.setDate(end.getDate() + 7); // next 7 days inclusive of today

    const inWindow = (d: Date) => d >= today && d <= end;

    const [rows, gatherings] = await Promise.all([
      query<MemberEvent>(`
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

    const items: DigestItem[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const typeIcon = row.event_type === 'birthday' ? '🎂'
        : row.event_type === 'anniversary' ? '💍'
        : row.event_type === 'yahrtzeit' ? '🕯️' : '📅';

      const push = (d: Date) => {
        if (!inWindow(d)) return;
        // One line per person+occasion in the week: if a birthday's Hebrew and English
        // occurrences both fall in the window, don't list the same person twice.
        const key = `${row.id}-${row.event_type}`;
        if (seen.has(key)) return;
        seen.add(key);
        const years = yearsSince(d, row); // Hebrew-year count (correct across Jan 1)
        const noun = row.event_type === 'birthday' ? 'birthday'
          : row.event_type === 'anniversary' ? 'anniversary'
          : row.event_type === 'yahrtzeit' ? 'yahrzeit'
          : (row.event_type_label || 'event');
        const yPrefix = years && years > 0 && row.event_type !== 'other' ? `${ordinal(years)} ` : '';
        // Sanitize user-controlled fields (member name, custom event label) so a
        // smuggled newline can't inject extra spoofed lines into the broadcast.
        items.push({ date: d, icon: typeIcon, text: `${oneLine(fullName(row))}'s ${yPrefix}${oneLine(noun)}` });
      };

      // Hebrew-calendar occurrence(s) — this year and next, and ALL occurrences per
      // year (a Hebrew date can fall twice near the Dec/Jan boundary).
      for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
        for (const d of hebrewToGregorianAll(row.hebrew_day, row.hebrew_month, y)) push(d);
      }
      // Fixed-Gregorian birthday occurrence
      if (row.event_type === 'birthday' && row.original_english_date) {
        const orig = new Date(row.original_english_date + 'T12:00:00Z');
        for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
          push(solarInYear(y, orig.getUTCMonth(), orig.getUTCDate()));
        }
      }
    }

    for (const g of gatherings) {
      const [gy, gm, gd] = g.gather_date.split('-').map(Number);
      const d = new Date(gy, gm - 1, gd); d.setHours(0, 0, 0, 0);
      if (!inWindow(d)) continue;
      // Gathering title/location are user-editable — collapse control chars so a
      // smuggled newline can't inject extra spoofed lines into the broadcast.
      let label = oneLine(g.title);
      if (g.gather_time) {
        const [h, mn] = g.gather_time.split(':').map(Number);
        const ampm = h < 12 ? 'AM' : 'PM';
        label += ` · ${h % 12 === 0 ? 12 : h % 12}:${String(mn).padStart(2, '0')} ${ampm}`;
      }
      if (g.location) label += ` (${oneLine(g.location)})`;
      items.push({ date: d, icon: gatheringIcon(g.kind), text: label });
    }

    items.sort((a, b) => a.date.getTime() - b.date.getTime());

    const siteUrl = process.env.NEXTAUTH_URL || 'https://family-calendar.holzman-ai.com';
    const rangeLabel = `${fmtDay(today)} – ${fmtDay(end)}`;
    let message: string;
    if (items.length === 0) {
      message = `🗓️ *This week in the family* (${rangeLabel})\n\nNothing on the calendar this week. ${siteUrl}`;
    } else {
      const lines = items.map(it => `${it.icon} ${fmtDay(it.date)} — ${it.text}`);
      message = `🗓️ *This week in the family* (${rangeLabel})\n\n${lines.join('\n')}\n\nSee it all 👉 ${siteUrl}`;
    }

    // Recipients come from two sources, de-duplicated:
    //  1. Family members with a phone number + notifications enabled (managed in
    //     the app's Edit-person form) — the self-service path for relatives.
    //  2. The DIGEST_RECIPIENTS env list (comma-separated) — for people who should
    //     get the digest but aren't members of this tree (e.g. the maintainer).
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
      range: { start: ymd(today), end: ymd(end) },
      has_content: items.length > 0,
      count: items.length,
      message,
      recipients,
    });
  });
}
