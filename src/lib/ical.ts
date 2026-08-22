import { createEvents, EventAttributes } from 'ics';
import { query } from '@/lib/db';
import { EventWithMember, Gathering, gatheringIcon } from '@/lib/types';
import { getOccurrencesInRange, formatHebrewDate } from '@/lib/hebrew';
import { solarDateInYear } from '@/lib/solar';
import { fullName } from '@/lib/names';

/**
 * The occurrence half of a VEVENT UID: a local-time Date as `yyyymmdd`.
 *
 * Deliberately local, matching how the occurrence dates are built (all-day
 * VEVENTs carry no timezone) — `toISOString()` would shift the day backwards
 * for any timezone east of UTC and silently change every UID.
 */
function uidDay(date: Date): string {
  return (
    `${date.getFullYear()}` +
    `${String(date.getMonth() + 1).padStart(2, '0')}` +
    `${String(date.getDate()).padStart(2, '0')}`
  );
}

/** '18:30' -> '6:30 PM' (timezone-free, for embedding in iCal text). */
function fmtTimeLabel(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Build the subscribable feed.
 *
 * ## VEVENT UIDs
 *
 * Every VEVENT carries an explicit, deterministic `uid`. Calendar clients key
 * already-imported entries by UID, so leaving it off (the `ics` library then
 * mints a random one per call) makes every refresh look like a brand-new set of
 * events — subscribers accumulate duplicates. The scheme:
 *
 *   evt-<events.id>-h-<yyyymmdd>@luach   Hebrew-calendar occurrence
 *   evt-<events.id>-e-<yyyymmdd>@luach   fixed English birthday occurrence
 *   gth-<gatherings.id>-<yyyymmdd>@luach one-off gathering
 *
 * Three things make each part necessary:
 *
 *  - **The date.** One `events` row expands to many VEVENTs (one per year, and
 *    occasionally two in a year when a Hebrew date recurs either side of the
 *    Dec/Jan boundary), so the row id alone is not unique within a feed.
 *  - **The `h`/`e` kind.** A person's Hebrew and English birthdays fall on the
 *    same Gregorian day whenever the two anniversaries align — by definition in
 *    the birth year, and periodically thereafter. Same row, same day, two
 *    genuinely different entries.
 *  - **The `evt`/`gth` prefix.** `events.id` and `gatherings.id` are independent
 *    SERIAL sequences on separate tables, so the same integer routinely
 *    identifies one of each.
 *
 * No family id is needed: both tables have a single-column `id SERIAL PRIMARY
 * KEY` and are shared by all tenants (migrate-v10 added `family_id` as a plain
 * column, not part of the key), so ids are already globally unique. Keeping the
 * family out also means a UID survives a family being renamed or re-keyed.
 */
export async function generateICalFeed(): Promise<string> {
  const rows = await query<EventWithMember>(`
    SELECT e.*, fm.name, fm.last_name, fm.name_he, fm.family_branch
    FROM family_calendar.events e
    JOIN family_calendar.family_members fm ON e.family_member_id = fm.id
    ORDER BY fm.name
  `);

  // Include the Hebrew name alongside the English one when present — the feed is a
  // single shared URL, so bilingual titles serve both English- and Hebrew-reading
  // relatives. e.g. "Noa (נועה)".
  const feedName = (r: EventWithMember) => r.name_he ? `${fullName(r)} (${r.name_he})` : fullName(r);

  const today = new Date();
  const startDate = new Date(today.getFullYear(), 0, 1);   // Jan 1 of current year
  const endDate = new Date(today.getFullYear() + 2, 11, 31); // Dec 31 two years out

  const icsEvents: EventAttributes[] = [];

  for (const row of rows) {
    const occurrences = getOccurrencesInRange(
      row.hebrew_day,
      row.hebrew_month,
      startDate,
      endDate
    );

    const icon = row.event_type === 'birthday' ? '🎂' : row.event_type === 'anniversary' ? '💍' : row.event_type === 'yahrtzeit' ? '🕯️' : '📅';
    const typeLabel = row.event_type === 'birthday' ? 'Birthday' : row.event_type === 'anniversary' ? 'Anniversary' : row.event_type === 'yahrtzeit' ? 'Yahrzeit' : (row.event_type_label ?? 'Event');
    const hebrewDate = formatHebrewDate(row.hebrew_day, row.hebrew_month, row.hebrew_year);

    // Hebrew calendar occurrences
    for (const date of occurrences) {
      icsEvents.push({
        uid: `evt-${row.id}-h-${uidDay(date)}@luach`,
        start: [date.getFullYear(), date.getMonth() + 1, date.getDate()],
        duration: { days: 1 },
        title: `${icon} ${feedName(row)}'s Hebrew ${typeLabel}`,
        description: `Hebrew Date: ${hebrewDate}${row.note ? ` (${row.note})` : ''}${row.family_branch ? `\nFamily: ${row.family_branch}` : ''}`,
        status: 'CONFIRMED',
        busyStatus: 'FREE',
      });
    }

    // English calendar occurrences — fixed Gregorian date, birthdays only
    if (row.event_type === 'birthday' && row.original_english_date) {
      const orig = new Date(row.original_english_date + 'T12:00:00Z');
      const engMonth = orig.getUTCMonth();
      const engDay = orig.getUTCDate();
      for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) {
        // Clamp Feb-29 → Feb-28 (same as the app) so the feed and site agree.
        const date = solarDateInYear(y, engMonth, engDay);
        if (date >= startDate && date <= endDate) {
          icsEvents.push({
            uid: `evt-${row.id}-e-${uidDay(date)}@luach`,
            start: [date.getFullYear(), date.getMonth() + 1, date.getDate()],
            duration: { days: 1 },
            title: `📅 ${feedName(row)}'s English Birthday`,
            description: `English Calendar Birthday (same date every year)${row.note ? ` — ${row.note}` : ''}${row.family_branch ? `\nFamily: ${row.family_branch}` : ''}\nHebrew date: ${hebrewDate}`,
            status: 'CONFIRMED',
            busyStatus: 'FREE',
          });
        }
      }
    }
  }

  // One-off gatherings — a specific dated (and optionally timed) calendar entry.
  const gatherings = await query<Gathering>(
    `SELECT id, title, kind, to_char(gather_date, 'YYYY-MM-DD') AS gather_date,
            to_char(gather_time, 'HH24:MI') AS gather_time, location, description,
            created_at, updated_at
     FROM family_calendar.gatherings WHERE gather_date >= $1`,
    [`${startDate.getFullYear()}-01-01`]
  );
  for (const g of gatherings) {
    const [gy, gm, gd] = g.gather_date.split('-').map(Number);
    // Emit as an ALL-DAY event with the time carried in the title/description. A
    // real timed VEVENT would be converted from the feed-generator's timezone to
    // UTC, shifting the time for relatives in other timezones (and for the UTC
    // server vs a local dev box). All-day keeps the date stable everywhere.
    const timeLabel = g.gather_time ? fmtTimeLabel(g.gather_time) : '';
    const descParts = [
      g.gather_time ? `Time: ${timeLabel}` : '',
      g.location ? `Where: ${g.location}` : '',
      g.description ?? '',
    ].filter(Boolean);
    const base: EventAttributes = {
      // gather_date is already a zero-padded YYYY-MM-DD (to_char, above), so the
      // UID day comes straight off the string — no Date round-trip to shift it.
      uid: `gth-${g.id}-${g.gather_date.replace(/-/g, '')}@luach`,
      start: [gy, gm, gd],
      duration: { days: 1 },
      title: `${gatheringIcon(g.kind)} ${g.title}${timeLabel ? ` · ${timeLabel}` : ''}`,
      status: 'CONFIRMED',
      busyStatus: 'FREE',
    };
    if (descParts.length) base.description = descParts.join('\n');
    if (g.location) base.location = g.location;
    icsEvents.push(base);
  }

  const { value, error } = createEvents(icsEvents);
  if (error || !value) {
    throw new Error(`iCal generation failed: ${error}`);
  }
  return value;
}
