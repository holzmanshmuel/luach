import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { systemQuery, query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { generateICalFeed } from '@/lib/ical';
import { getOccurrencesInRange } from '@/lib/hebrew';

/**
 * VEVENT identity. A calendar client keys every entry it has already imported by
 * UID: same UID on the next refresh = update the existing entry, new UID = a
 * brand-new entry. The `ics` library mints a random UID for any event that does
 * not carry one, so an un-UID'd feed re-issues every occurrence under a fresh
 * identity on EVERY fetch — subscribers accumulate duplicates and lose any local
 * edits. These tests pin the contract:
 *
 *   a VEVENT's UID is a pure function of the row it came from and the day it
 *   falls on — stable across generations, unique within a feed.
 *
 * Requires DATABASE_URL pointing at staging Postgres with migration v13 applied,
 * connected as app_user so RLS is genuinely enforced during feed generation.
 */

const PERSON = 'ZzUidperson';

// The exact window generateICalFeed expands occurrences over.
const TODAY = new Date();
const START = new Date(TODAY.getFullYear(), 0, 1);
const END = new Date(TODAY.getFullYear() + 2, 11, 31);

let familyId: number;
let sharedId: number;
let collisionDay: string; // yyyymmdd — a day carrying THREE distinct VEVENTs

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uidsOf(feed: string): string[] {
  return feed
    .split(/\r?\n/)
    .filter(l => l.startsWith('UID:'))
    .map(l => l.slice('UID:'.length).trim());
}

function veventCount(feed: string): number {
  return feed.split(/\r?\n/).filter(l => l.trim() === 'BEGIN:VEVENT').length;
}

beforeAll(async () => {
  const [fam] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name) VALUES ('UID Scheme Family') RETURNING id"
  );
  familyId = fam.id;

  // Pick one id that is free in BOTH events and gatherings and use it for a row
  // in each. events.id and gatherings.id are independent SERIAL sequences on
  // separate tables, so in production the same integer really does identify an
  // event AND a gathering — a UID built from the bare id would fuse them.
  const [free] = await systemQuery<{ id: string }>(
    `SELECT GREATEST(
       (SELECT COALESCE(MAX(id), 0) FROM family_calendar.events),
       (SELECT COALESCE(MAX(id), 0) FROM family_calendar.gatherings)
     ) + 1000 AS id`
  );
  sharedId = Number(free.id);

  // A Hebrew birthday occurrence, reused verbatim as the person's fixed English
  // birthday and as a gathering date. That makes the Hebrew occurrence, the
  // English occurrence and the gathering all land on the SAME day — the case
  // where a date-only UID collapses three entries into one.
  const collide = getOccurrencesInRange(15, 'Sivan', START, END)[0];
  collisionDay = ymd(collide).replace(/-/g, '');

  await runWithTenant(familyId, async () => {
    const [person] = await query<{ id: number }>(
      'INSERT INTO family_calendar.family_members (name) VALUES ($1) RETURNING id',
      [PERSON]
    );
    await query(
      `INSERT INTO family_calendar.events
         (id, family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year, original_english_date)
       VALUES ($1, $2, 'birthday', 15, 'Sivan', 5750, $3)`,
      [sharedId, person.id, ymd(collide)]
    );
    await query(
      `INSERT INTO family_calendar.gatherings (id, title, gather_date)
       VALUES ($1, 'Zz Uid Gathering', $2)`,
      [sharedId, ymd(collide)]
    );
  });
});

afterAll(async () => {
  // family_members/events/gatherings all FK-cascade off families (migrate-v10).
  await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
});

describe('generateICalFeed — stable VEVENT UIDs', () => {
  it('gives every VEVENT a UID', async () => {
    const feed = await runWithTenant(familyId, () => generateICalFeed());
    expect(veventCount(feed)).toBeGreaterThan(0);
    expect(uidsOf(feed)).toHaveLength(veventCount(feed));
  });

  it('produces byte-identical UIDs on two consecutive generations', async () => {
    const first = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    const second = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('never repeats a UID within one feed', async () => {
    const uids = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('uses the documented <kind>-<row id>-<yyyymmdd>@luach shape', async () => {
    const uids = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    for (const uid of uids) {
      expect(uid).toMatch(/^(evt-\d+-[he]|gth-\d+)-\d{8}@luach$/);
    }
  });

  it('keeps the Hebrew occurrence, the English birthday and the gathering apart on a shared day', async () => {
    const uids = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    // Same row id, same calendar day, three genuinely different entries.
    expect(uids).toContain(`evt-${sharedId}-h-${collisionDay}@luach`);
    expect(uids).toContain(`evt-${sharedId}-e-${collisionDay}@luach`);
    expect(uids).toContain(`gth-${sharedId}-${collisionDay}@luach`);
  });

  it('re-derives the same UID after an unrelated edit to the row', async () => {
    const before = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    await runWithTenant(familyId, () =>
      query('UPDATE family_calendar.events SET note = $1 WHERE id = $2', ['renamed', sharedId])
    );
    const after = uidsOf(await runWithTenant(familyId, () => generateICalFeed()));
    // The UID tracks identity (row + day), not content — a retitled event must
    // update in place on the subscriber's calendar, not appear twice.
    expect(after).toEqual(before);
  });
});

/**
 * Feed language (HOLZMAN-63). The feed is the one surface that cannot read the
 * `lang` cookie — calendar apps send no cookies — so the language is passed in
 * explicitly. Two things are worth pinning:
 *
 *  1. Hebrew really renders. The title templates are whole strings per event
 *     type (Hebrew takes no possessive 's), and `getT()` silently falls back to
 *     English for a missing key — so a broken template degrades to English
 *     rather than failing, which is exactly the kind of bug a test has to catch.
 *  2. UIDs do NOT change with language. Subscribers who switch must see their
 *     existing entries UPDATE, not a duplicate calendar.
 */
describe('feed language (HOLZMAN-63)', () => {
  // ics folds long lines with CRLF + a leading space; Hebrew is multibyte, so a
  // summary can be split mid-word. Unfold before matching on content.
  const unfold = (feed: string) => feed.replace(/\r?\n[ \t]/g, '');

  it('renders Hebrew titles for he, English for the default', async () => {
    const en = unfold(await runWithTenant(familyId, () => generateICalFeed()));
    const he = unfold(await runWithTenant(familyId, () => generateICalFeed('he')));

    expect(en).toContain("'s Hebrew Birthday");
    expect(he).toContain('יום הולדת עברי של');

    // the person's name still reaches the Hebrew title
    expect(he).toContain(PERSON);
    // and no English boilerplate leaked through a fallback
    expect(he).not.toContain('Hebrew Birthday');
    expect(he).not.toContain('English Birthday');
  });

  it('keeps VEVENT UIDs identical across languages, so a switch updates in place', async () => {
    const en = await runWithTenant(familyId, () => generateICalFeed());
    const he = await runWithTenant(familyId, () => generateICalFeed('he'));

    expect(uidsOf(he)).toEqual(uidsOf(en));
    expect(veventCount(he)).toBe(veventCount(en));
  });
});
