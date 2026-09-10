import { NextRequest, NextResponse } from 'next/server';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant, isValidFamilyId } from '@/lib/tenant';
import { EventWithMember } from '@/lib/types';
import { hebrewToGregorianAll, formatHebrewDate, yearsSince } from '@/lib/hebrew';
import { safeEqual } from '@/lib/safe-equal';
import { fullName } from '@/lib/names';

export const dynamic = 'force-dynamic';

interface EnrichedMemberEvent extends EventWithMember {
  phone_e164: string | null;
  notifications_enabled: boolean;
}

interface TodayEvent {
  person_id: number;
  person_name: string;
  nickname: string | null;
  person_phone: string | null;
  family_branch: string | null;
  event_type: string;
  event_type_label: string | null;
  years_since: number | null;
  hebrew_date: string;
  gregorian_date: string;
  note: string | null;
  date_type: 'hebrew' | 'gregorian';
}

/** Local YYYY-MM-DD. toISOString() would shift by the TZ offset (with
 *  TZ=Asia/Jerusalem, local midnight is the previous day in UTC → date off by one). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export async function GET(request: NextRequest) {
  const expected = process.env.N8N_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'N8N_TOKEN not configured on server.' },
      { status: 500 }
    );
  }

  // Accept token via Authorization: Bearer <token> or ?token=<token>.
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null;
  const tokenParam = request.nextUrl.searchParams.get('token');
  const token = bearer ?? tokenParam;

  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
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
    const rows = await query<EnrichedMemberEvent>(`
      SELECT e.*, fm.name, fm.last_name, fm.family_branch, fm.nickname, fm.photo_url,
             fm.phone_e164, fm.notifications_enabled
      FROM family_calendar.events e
      JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
      WHERE fm.notifications_enabled = TRUE
    `);

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const results: TodayEvent[] = [];

    for (const row of rows) {
      const hebrewDateDisplay = formatHebrewDate(
        row.hebrew_day,
        row.hebrew_month,
        row.hebrew_year
      );

      // Hebrew occurrence — does this Hebrew date fall on today? Check ALL occurrences
      // this civil year (a Hebrew date can fall twice near the Dec/Jan boundary).
      const hebrewGreg = hebrewToGregorianAll(row.hebrew_day, row.hebrew_month, today.getFullYear())
        .find(d => sameDay(d, today));
      if (hebrewGreg) {
        results.push({
          person_id: row.family_member_id,
          person_name: fullName(row),
          nickname: row.nickname,
          person_phone: row.phone_e164,
          family_branch: row.family_branch,
          event_type: row.event_type,
          event_type_label: row.event_type_label,
          years_since: yearsSince(hebrewGreg, row), // Hebrew-year count (correct across Jan 1)
          hebrew_date: hebrewDateDisplay,
          gregorian_date: ymd(hebrewGreg),
          note: row.note,
          date_type: 'hebrew',
        });
      }

      // Fixed-Gregorian occurrence — only for birthdays that stored an English date
      if (row.event_type === 'birthday' && row.original_english_date) {
        const orig = new Date(row.original_english_date + 'T12:00:00Z');
        if (
          orig.getUTCMonth() === today.getMonth() &&
          orig.getUTCDate() === today.getDate()
        ) {
          results.push({
            person_id: row.family_member_id,
            person_name: fullName(row),
            nickname: row.nickname,
            person_phone: row.phone_e164,
            family_branch: row.family_branch,
            event_type: row.event_type,
            event_type_label: row.event_type_label,
            years_since: row.gregorian_year ? today.getFullYear() - row.gregorian_year : null,
            hebrew_date: hebrewDateDisplay,
            gregorian_date: ymd(today),
            note: row.note,
            date_type: 'gregorian',
          });
        }
      }
    }

    return NextResponse.json({ date: ymd(today), events: results });
  });
}
