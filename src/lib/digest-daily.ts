/**
 * The ONE morning digest — the pure assembler behind `GET /api/digest/daily`.
 *
 * It replaces two n8n crons (a Sunday-evening weekly digest and a nightly
 * yahrzeit reminder) with a single 08:00 job, by folding their content into up
 * to three blocks. Empty blocks are omitted; when all three are empty the
 * message is `''` and `has_content` is false, so the workflow sends nothing.
 *
 *   1. **Today** — everything falling today: birthdays, anniversaries, custom
 *      recurring events, simchas, and yahrzeits whose date IS today. Weekly-digest
 *      voice and glyphs.
 *   2. **Tonight begins** — yahrzeits whose Hebrew date begins at nightfall
 *      tonight, i.e. tomorrow's yahrzeits. This is the retired reminder's
 *      eve-before semantics (`?lead=1`): a yahrzeit and its candle start at
 *      sundown, so a "today only" digest would tell people the morning AFTER the
 *      candle should have been lit. Do not drop this block.
 *   3. **Later in the week** — Sundays only: tomorrow through Saturday,
 *      de-duplicated against blocks 1 and 2 so nothing is said twice.
 *
 * "Today" and "is it Sunday" are decided in the deployment's timezone (see
 * `zoned-day`), never in UTC and never via `toISOString()`.
 */
import type { EventWithMember, Gathering } from './types';
import {
  collectItems,
  toLine,
  type DigestItem,
  type DigestLine,
} from './digest';
import {
  addDays,
  civilDayInZone,
  deploymentTimeZone,
  fmtLongDay,
  fmtShortDay,
  isSunday,
  saturdayOfWeek,
  ymd,
} from './zoned-day';

export interface DailyDigestInput {
  /** Every event row for the family (joined to its member). */
  events: EventWithMember[];
  /** Every gathering (simcha) row for the family. */
  gatherings?: Gathering[];
  /** This deployment's public origin — the link recipients tap. */
  siteUrl: string;
  /** The instant the digest is being built. Defaults to now. */
  now?: Date;
  /** IANA zone to reckon the civil day in. Defaults to the deployment's. */
  timeZone?: string;
}

export interface DailyDigest {
  /** Today's civil date in `timezone`, `YYYY-MM-DD`. */
  date: string;
  timezone: string;
  /** Whether the "Later in the week" block applies today. */
  is_sunday: boolean;
  /** True iff at least one block has content. The n8n job gates on this. */
  has_content: boolean;
  counts: { today: number; tonight: number; later_this_week: number; week_ahead: number };
  today: DigestLine[];
  tonight: DigestLine[];
  later_this_week: DigestLine[];
  /** Yahrzeits exactly a week out — the retired cron's lead=7 notice. */
  week_ahead: DigestLine[];
  /** Ready-to-send WhatsApp body, or `''` when there is nothing to say. */
  message: string;
}

const TONIGHT_HEADING = '🕯️ *Tonight begins* — light a memorial candle at sundown:';
/**
 * The week-ahead yahrzeit notice. Carried over from the retired reminder's
 * `?lead=7` call — see the block comment on WEEK_AHEAD_LEAD_DAYS below.
 */
const WEEK_AHEAD_HEADING = '🕯️ *A yahrzeit is a week away:*';

/**
 * How many days ahead the week-ahead yahrzeit notice looks.
 *
 * The retired `reminders/yahrzeit` cron ran TWICE a day: once at the default
 * `lead=1` (the candle is lit this evening) and once at `lead=7`. Folding only the
 * eve-before into this digest would have silently dropped the week's notice the
 * moment the old schedule was switched off — and a week is the point: it is the
 * notice people actually plan a minyan around.
 */
const WEEK_AHEAD_LEAD_DAYS = 7;
const MEMORY_BLESSING = 'May their memory be a blessing. 🤍';
const LATER_HEADING = '*Later in the week:*';

/** Assemble the whole response body. Pure: same inputs, same message. */
export function buildDailyDigest(input: DailyDigestInput): DailyDigest {
  const { events, gatherings = [], siteUrl } = input;
  const timeZone = input.timeZone ?? deploymentTimeZone();
  const today = civilDayInZone(input.now ?? new Date(), timeZone);
  const tomorrow = addDays(today, 1);
  // A window can cross New Year (a Sunday in late December), so resolve Hebrew
  // dates in this civil year and the next.
  const years = [today.getFullYear(), today.getFullYear() + 1];

  // One shared de-dup set, threaded through the blocks IN ORDER: an occasion
  // named in "Today" or "Tonight begins" can't reappear under "Later in the week".
  const seen = new Set<string>();

  const todayItems = collectItems({
    events, gatherings, from: today, to: today, years, seen,
  });
  const tonightItems = collectItems({
    events, from: tomorrow, to: tomorrow, years, seen,
    eventTypes: ['yahrtzeit'], style: 'memorial',
  });
  // Exactly `WEEK_AHEAD_LEAD_DAYS` out, matching the retired cron's lead=7 call.
  // Threaded through the same `seen` set, so on a Sunday a yahrzeit that also
  // falls inside "Later in the week" is named once, not twice.
  const weekAheadItems = collectItems({
    events, from: addDays(today, WEEK_AHEAD_LEAD_DAYS), to: addDays(today, WEEK_AHEAD_LEAD_DAYS),
    years, seen, eventTypes: ['yahrtzeit'], style: 'memorial',
  });
  const laterItems = isSunday(today)
    ? collectItems({
        events, gatherings, from: tomorrow, to: saturdayOfWeek(today), years, seen,
      })
    : [];

  return {
    date: ymd(today),
    timezone: timeZone,
    is_sunday: isSunday(today),
    has_content:
      todayItems.length + tonightItems.length + laterItems.length + weekAheadItems.length > 0,
    counts: {
      today: todayItems.length,
      tonight: tonightItems.length,
      later_this_week: laterItems.length,
      week_ahead: weekAheadItems.length,
    },
    today: todayItems.map(toLine),
    tonight: tonightItems.map(toLine),
    later_this_week: laterItems.map(toLine),
    week_ahead: weekAheadItems.map(toLine),
    message: buildMessage(today, todayItems, tonightItems, laterItems, weekAheadItems, siteUrl),
  };
}

/**
 * The WhatsApp body. Blocks are separated by a blank line and any empty one is
 * left out entirely; the whole message is `''` when nothing is happening.
 */
function buildMessage(
  today: Date,
  todayItems: DigestItem[],
  tonightItems: DigestItem[],
  laterItems: DigestItem[],
  weekAheadItems: DigestItem[],
  siteUrl: string
): string {
  const blocks: string[] = [];

  if (todayItems.length > 0) {
    blocks.push(todayItems.map(it => `${it.icon} ${it.text}`).join('\n'));
  }

  if (tonightItems.length > 0) {
    blocks.push([
      TONIGHT_HEADING,
      ...tonightItems.map(it => `${it.icon} ${it.text}`),
      MEMORY_BLESSING,
    ].join('\n'));
  }

  if (laterItems.length > 0) {
    blocks.push([
      LATER_HEADING,
      ...laterItems.map(it => `${it.icon} ${fmtShortDay(it.on)} — ${it.text}`),
    ].join('\n'));
  }

  if (weekAheadItems.length > 0) {
    blocks.push([
      WEEK_AHEAD_HEADING,
      ...weekAheadItems.map(it => `${it.icon} ${fmtShortDay(it.on)} — ${it.text}`),
      MEMORY_BLESSING,
    ].join('\n'));
  }

  if (blocks.length === 0) return '';
  return [
    `🗓️ *Today in the family* — ${fmtLongDay(today)}`,
    ...blocks,
    `See it all 👉 ${siteUrl}`,
  ].join('\n\n');
}
