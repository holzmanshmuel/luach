/**
 * Shared shaping for the WhatsApp broadcast feeds (`/api/digest/week`,
 * `/api/digest/daily`): turn event + gathering rows into dated, sanitized,
 * one-line-per-occasion items, and work out who may receive them.
 *
 * This is deliberately DB-free and pure so the message text is unit-testable
 * without Postgres. The formatting is the weekly digest's, character for
 * character — that route now builds its items from here, so the daily digest
 * cannot drift away from the voice the family already knows.
 *
 * SECURITY: every user-editable string that reaches a line (member name, custom
 * event label, gathering title/location) goes through {@link oneLine}. The
 * message is newline-delimited and broadcast verbatim, so a smuggled newline in
 * a title would otherwise inject spoofed lines. Do not interpolate a raw field.
 */
import { EventWithMember, Gathering, gatheringIcon, type EventType } from './types';
import { hebrewToGregorianAll, yearsSince } from './hebrew';
import { fullName } from './names';
import { oneLine } from './text';
import { ordinal } from './event-phrase';
import { solarDateInYear } from './solar';
import { civilDayToDate, ymd } from './zoned-day';

/** The event-joined-to-member row shape the broadcast feeds select. */
export interface DigestEventRow extends EventWithMember {
  phone_e164: string | null;
  notifications_enabled: boolean;
}

/** One rendered occasion, as it appears in a route's JSON. */
export interface DigestLine {
  /** The civil date it falls on, `YYYY-MM-DD`. */
  date: string;
  /** Leading glyph — 🎂 💍 🕯️ 📅, or the simcha's own. */
  icon: string;
  /** Sanitized single-line text, e.g. `Dina Levi's 42nd birthday`. */
  text: string;
  kind: 'event' | 'gathering';
  event_type: EventType | null;
  event_id: number | null;
  gathering_id: number | null;
  person_id: number | null;
  person_name: string | null;
  years_since: number | null;
}

/** A {@link DigestLine} plus the internals used while assembling a message. */
export interface DigestItem extends DigestLine {
  /** Civil-date carrier for sorting and day labels (see `zoned-day`). */
  on: Date;
  /** De-dup key — one line per occasion per message. */
  key: string;
}

/** Strip the assembly-only fields, leaving the JSON-safe line a route returns. */
export function toLine(item: DigestItem): DigestLine {
  return {
    date: item.date,
    icon: item.icon,
    text: item.text,
    kind: item.kind,
    event_type: item.event_type,
    event_id: item.event_id,
    gathering_id: item.gathering_id,
    person_id: item.person_id,
    person_name: item.person_name,
    years_since: item.years_since,
  };
}

/** The glyph for an event type. Matches the weekly digest exactly. */
export function eventIcon(eventType: string): string {
  return eventType === 'birthday' ? '🎂'
    : eventType === 'anniversary' ? '💍'
    : eventType === 'yahrtzeit' ? '🕯️' : '📅';
}

/** The occasion noun — a custom `other` event uses its own label. */
function eventNoun(row: EventWithMember): string {
  return row.event_type === 'birthday' ? 'birthday'
    : row.event_type === 'anniversary' ? 'anniversary'
    : row.event_type === 'yahrtzeit' ? 'yahrzeit'
    : (row.event_type_label || 'event');
}

/**
 * The weekly digest's voice: `Dina Levi's 42nd birthday`. The Nth count is a
 * HEBREW-year count (see `yearsSince`) and is omitted for `other` events and
 * when the origin year is unknown.
 */
export function occasionText(row: EventWithMember, occurrence: Date): string {
  const years = yearsSince(occurrence, row);
  const prefix = years && years > 0 && row.event_type !== 'other' ? `${ordinal(years)} ` : '';
  return `${oneLine(fullName(row))}'s ${prefix}${oneLine(eventNoun(row))}`;
}

/**
 * The yahrzeit reminder's voice: `Yaakov Levi (9th yahrzeit)` — used under the
 * daily digest's "Tonight begins" heading, so the eve-before reminder reads the
 * way it always has. Callers add the 🕯️ themselves.
 */
export function memorialText(row: EventWithMember, occurrence: Date): string {
  const n = yearsSince(occurrence, row);
  const label = n && n > 0 ? ` (${ordinal(n)} yahrzeit)` : '';
  return `${oneLine(fullName(row))}${label}`;
}

/** `Cohen wedding · 6:30 PM (Jerusalem)`. Matches the weekly digest exactly. */
export function gatheringText(g: Gathering): string {
  let label = oneLine(g.title);
  if (g.gather_time) {
    const [h, mn] = g.gather_time.split(':').map(Number);
    const ampm = h < 12 ? 'AM' : 'PM';
    label += ` · ${h % 12 === 0 ? 12 : h % 12}:${String(mn).padStart(2, '0')} ${ampm}`;
  }
  if (g.location) label += ` (${oneLine(g.location)})`;
  return label;
}

/**
 * Every civil date this event recurs on across `years`, in the order the weekly
 * digest checks them: the Hebrew-date occurrence(s) first — ALL of them, since a
 * Hebrew date can fall twice in one civil year near the Dec/Jan boundary — then
 * the fixed-Gregorian birthday date. Order is load-bearing: when an occasion
 * falls twice inside one window, the first hit wins the (single) line.
 */
export function eventOccurrences(row: EventWithMember, years: number[]): Date[] {
  const out: Date[] = [];
  for (const y of years) {
    out.push(...hebrewToGregorianAll(row.hebrew_day, row.hebrew_month, y));
  }
  if (row.event_type === 'birthday' && row.original_english_date) {
    // DATE comes back as 'YYYY-MM-DD' (db.ts pins the type parser), so this is
    // an exact midnight-UTC parse, then read via getUTC* — no offset slippage.
    const orig = new Date(row.original_english_date + 'T12:00:00Z');
    for (const y of years) {
      out.push(solarDateInYear(y, orig.getUTCMonth(), orig.getUTCDate()));
    }
  }
  return out;
}

export interface CollectItemsOptions {
  events: EventWithMember[];
  gatherings?: Gathering[];
  /** Window start, inclusive — a civil-date carrier. */
  from: Date;
  /** Window end, inclusive. */
  to: Date;
  /**
   * Civil years to resolve Hebrew dates in. Defaults to the window's opening
   * year and the next, which covers any window that crosses New Year.
   */
  years?: number[];
  /**
   * Restrict to these event types (the daily digest's "Tonight begins" block
   * wants yahrzeits only). Gatherings are independent — they are collected only
   * when `gatherings` is passed.
   */
  eventTypes?: EventType[];
  /**
   * De-dup keys already claimed. Pass one Set through several calls and later
   * blocks will not repeat an occasion an earlier block already named.
   */
  seen?: Set<string>;
  /** Line voice: the weekly digest's possessive (default) or the memorial one. */
  style?: 'occasion' | 'memorial';
}

/**
 * Collect every occasion falling in `[from, to]` (inclusive, compared as civil
 * dates), one line per occasion, sorted by date.
 */
export function collectItems(opts: CollectItemsOptions): DigestItem[] {
  const { events, gatherings = [], from, to, eventTypes, style = 'occasion' } = opts;
  const years = opts.years ?? [from.getFullYear(), from.getFullYear() + 1];
  const seen = opts.seen ?? new Set<string>();
  const fromKey = ymd(from);
  const toKey = ymd(to);
  const inWindow = (key: string) => key >= fromKey && key <= toKey;

  const items: DigestItem[] = [];

  for (const row of events) {
    if (eventTypes && !eventTypes.includes(row.event_type)) continue;
    const key = `event-${row.id}-${row.event_type}`;
    for (const occurrence of eventOccurrences(row, years)) {
      const date = ymd(occurrence);
      if (!inWindow(date)) continue;
      if (seen.has(key)) break; // one line per occasion, per message
      seen.add(key);
      items.push({
        on: occurrence,
        key,
        date,
        icon: eventIcon(row.event_type),
        text: style === 'memorial'
          ? memorialText(row, occurrence)
          : occasionText(row, occurrence),
        kind: 'event',
        event_type: row.event_type,
        event_id: row.id,
        gathering_id: null,
        person_id: row.family_member_id,
        person_name: oneLine(fullName(row)),
        years_since: yearsSince(occurrence, row),
      });
    }
  }

  for (const g of gatherings) {
    // gather_date is a 'YYYY-MM-DD' civil day (to_char in SQL). Rehydrate it as a
    // local-NOON carrier via the shared helper, not `new Date(y, m, d)`: midnight
    // does not exist on a spring-forward day in a zone that shifts at 00:00, and
    // the constructor then lands on the previous date. Same ymd() output either way
    // in Asia/Jerusalem — this is about not depending on that.
    const on = civilDayToDate(g.gather_date);
    const date = ymd(on);
    if (!inWindow(date)) continue;
    const key = `gathering-${g.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      on,
      key,
      date,
      icon: gatheringIcon(g.kind),
      text: gatheringText(g),
      kind: 'gathering',
      event_type: null,
      event_id: null,
      gathering_id: g.id,
      person_id: null,
      person_name: null,
      years_since: null,
    });
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items;
}

/**
 * The phone numbers of family members who OPTED IN — a phone number on record
 * plus notifications enabled — de-duplicated (a member with three events is one
 * recipient).
 *
 * Note what is NOT here: the deployment-wide `DIGEST_RECIPIENTS` env list. On a
 * multi-family deployment that list is applied to every family, so the operator's
 * own phone receives every family's private dates. `/api/digest/daily` therefore
 * uses this function alone. The two legacy routes still add the env list for
 * self-hosters who depend on it; see SETUP-WHATSAPP.md.
 */
export function memberRecipients(
  rows: { phone_e164: string | null; notifications_enabled: boolean }[]
): string[] {
  return [
    ...new Set(
      rows
        .filter(r => r.notifications_enabled && r.phone_e164 && r.phone_e164.trim())
        .map(r => r.phone_e164!.trim())
    ),
  ];
}
