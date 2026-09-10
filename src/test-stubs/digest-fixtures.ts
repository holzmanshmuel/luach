/**
 * TEST-ONLY fixture builders for the WhatsApp digest assemblers
 * (`lib/digest.ts`, `lib/digest-daily.ts`), which are pure functions over rows —
 * so their whole message contract can be pinned without Postgres.
 *
 * The Hebrew date of an event is derived from the civil date it should fall on,
 * through the app's OWN converter, so a fixture can never quietly disagree with
 * the calendar maths.
 */
import { gregorianToHebrew } from '@/lib/hebrew';
import type { DigestEventRow } from '@/lib/digest';
import type { EventType, Gathering, GatheringKind } from '@/lib/types';

/** A civil-date carrier, the way the routes build one (noon — see `zoned-day`). */
export function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12);
}

export interface EventFixtureOpts {
  name?: string;
  last?: string | null;
  type?: EventType;
  label?: string | null;
  /** Hebrew years since the origin, so the Nth count is deterministic. null = unknown. */
  yearsAgo?: number | null;
  /** A fixed civil birthday, 'YYYY-MM-DD' (what the DB hands back for a DATE). */
  english?: string | null;
  phone?: string | null;
  notify?: boolean;
}

let idSeq = 0;

/** An event row whose HEBREW date is that of `date`, so it recurs on `date`. */
export function eventOn(date: Date, opts: EventFixtureOpts = {}): DigestEventRow {
  const heb = gregorianToHebrew(date);
  const yearsAgo = opts.yearsAgo === undefined ? 42 : opts.yearsAgo;
  return {
    id: ++idSeq,
    family_member_id: 100 + idSeq,
    event_type: opts.type ?? 'birthday',
    event_type_label: opts.label ?? null,
    hebrew_day: heb.day,
    hebrew_month: heb.month,
    hebrew_year: yearsAgo == null ? null : heb.year - yearsAgo,
    gregorian_year: null,
    original_english_date: opts.english ?? null,
    note: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    name: opts.name ?? 'Dina',
    last_name: opts.last === undefined ? 'Levi' : opts.last,
    name_he: null,
    nickname: null,
    family_branch: 'Levi',
    photo_url: null,
    phone_e164: opts.phone ?? null,
    notifications_enabled: opts.notify ?? false,
  };
}

/** A one-off simcha on a given 'YYYY-MM-DD'. */
export function gatheringOn(date: string, o: Partial<Gathering> = {}): Gathering {
  return {
    id: ++idSeq,
    title: o.title ?? 'Cohen wedding',
    kind: (o.kind ?? 'wedding') as GatheringKind,
    gather_date: date,
    gather_time: o.gather_time ?? null,
    location: o.location ?? null,
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
