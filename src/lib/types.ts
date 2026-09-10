import type { FamilyColor } from '@/lib/family-color';
import type { CivilDay } from '@/lib/civil-day';

/**
 * Internal event-type identifiers. NOTE the spelling split, deliberate and load-
 * bearing: the identifier / DB `events.event_type` value is 'yahrtzeit', but every
 * USER-FACING label spells it "Yahrzeit" (the common English spelling) — see the
 * translations (`event.yahrtzeit` → "Yahrzeit"), ical.ts, and lib/event-phrase.ts.
 * Do NOT "fix" the identifier to match the display spelling without a data
 * migration of the events table (and the n8n feeds that filter on 'yahrtzeit').
 */
export type EventType = 'birthday' | 'anniversary' | 'yahrtzeit' | 'other';

/** Identifies which family a merged item belongs to, in the combined view. Absent in single-family mode. */
export interface FamilyTag {
  id: number;
  name: string;
  nameHe: string | null;
  color: FamilyColor;
}

export const EVENT_TYPES: { value: EventType; label: string; icon: string }[] = [
  { value: 'birthday',    label: 'Birthday',    icon: '🎂' },
  { value: 'anniversary', label: 'Anniversary', icon: '💍' },
  { value: 'yahrtzeit',   label: 'Yahrzeit',    icon: '🕯️' },
  { value: 'other',       label: 'Other',       icon: '📅' },
];

/**
 * The surname of the branch a person belongs to — the "side" of the family they
 * are on. Used to tint avatars, tree cards and timeline entries, and as the key
 * for the per-viewer surname-spelling feature (see `lib/spelling-core.ts`).
 *
 * ── SELF-HOSTERS: THIS IS DATA, NOT CODE. ──
 * The list of branches is PER FAMILY — `families.branches`, edited by the family's
 * owner at `/admin/branches`, falling back to the `FAMILY_BRANCHES` environment
 * variable and then to the built-in default (see `lib/branches.ts` for the
 * resolution chain and the ORDER-IS-LOAD-BEARING colour rule, and
 * `lib/branches-server.ts` for the read). Nothing here needs editing to run the
 * app for a different family.
 *
 * The type is deliberately a bare `string`: `family_members.family_branch` is a
 * plain TEXT column with no constraint, so a database routinely holds values the
 * current configuration doesn't list — rows written before the list changed, or
 * by another deployment. Nothing in the app may narrow on the value; unknown
 * ones fall through to the neutral / catch-all treatment.
 */
export type FamilyBranch = string;

export const HEBREW_MONTHS = [
  'Tishrei',
  'Cheshvan',
  'Kislev',
  'Tevet',
  'Shvat',
  'Adar',
  'Adar I',
  'Adar II',
  'Nisan',
  'Iyyar',
  'Sivan',
  'Tamuz',
  'Av',
  'Elul',
] as const;

export type HebrewMonth = (typeof HEBREW_MONTHS)[number];

export interface FamilyMember {
  id: number;
  /** Given name(s) — first and any middle names. Surname lives in last_name. */
  name: string;
  /** Surname. Nullable while legacy rows haven't been split yet. */
  last_name?: string | null;
  name_he: string | null;
  name_he_status?: 'suggested' | 'confirmed' | null;
  maiden_name: string | null;
  maiden_name_he: string | null;
  nickname: string | null;
  family_branch: FamilyBranch | null;
  photo_url: string | null;
  phone_e164: string | null;
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  family_member_id: number;
  event_type: EventType;
  event_type_label: string | null;
  hebrew_day: number;
  hebrew_month: string;
  hebrew_year: number | null;
  gregorian_year: number | null;
  original_english_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventWithMember extends Event {
  name: string;
  last_name?: string | null;
  name_he: string | null;
  nickname: string | null;
  family_branch: FamilyBranch | null;
  photo_url: string | null;
}

export interface CalendarEvent extends EventWithMember {
  /**
   * The civil day this occurrence falls on, `YYYY-MM-DD` — **not a `Date`**.
   *
   * `CalendarEvent` is handed straight from Server Components into client ones
   * (`CalendarGrid`, `HebrewCalendarGrid`, `UpcomingEvents`, `EventDetailModal`),
   * and React's wire format preserves the *instant*, not the calendar day: a
   * `Date` built here at local midnight in `TZ=Asia/Jerusalem` arrived in the
   * browser as the previous evening UTC, so every relative outside Israel read
   * `.getDate()` one day early. The day is therefore decided ONCE on the server
   * (see `zoned-day.ts`) and travels as a string, which no clock can reinterpret.
   *
   * Use the pure helpers in `civil-day.ts` to read or shift it. Never
   * `new Date(gregorianDay)` in a client component.
   */
  gregorianDay: CivilDay;
  hebrewDateDisplay: string;
  daysUntil: number;
  dateType: 'hebrew' | 'gregorian';
  /**
   * The Nth count for this occurrence (Nth birthday/anniversary/yahrzeit),
   * computed server-side in HEBREW years so it's correct for Dec–Mar dates that
   * cross Jan 1. null when the origin year is unknown. Clients display this
   * directly rather than re-deriving (which would need @hebcal in the bundle).
   */
  yearsCount?: number | null;
  /**
   * Hebrew day-of-month to PLACE this occurrence on in the Hebrew grid, when it
   * differs from hebrew_day (e.g. a fixed-English birthday shown on the Hebrew
   * grid lands on a different Hebrew day than the person's Hebrew birthday). The
   * grid uses this; hebrew_day stays the true recurring day for the detail modal.
   */
  gridDay?: number;
  /** Set ONLY in combined (merged) view — which family this occurrence belongs to. */
  family?: FamilyTag;
}

/** Simcha / life-cycle event types — drive the calendar glyph for a gathering. */
export type GatheringKind =
  | 'wedding'
  | 'engagement'
  | 'bar_mitzvah'
  | 'brit'
  | 'upsherin'
  | 'sheva_brachot'
  | 'other';

export const GATHERING_KINDS: GatheringKind[] = [
  'wedding',
  'engagement',
  'bar_mitzvah',
  'brit',
  'upsherin',
  'sheva_brachot',
  'other',
];

/** Emoji shown on the chip/iCal/digest for each simcha type. */
export const GATHERING_KIND_ICON: Record<GatheringKind, string> = {
  wedding: '🕍',
  engagement: '💍',
  bar_mitzvah: '✡️',
  brit: '👶',
  upsherin: '✂️',
  sheva_brachot: '🥂',
  other: '🎉',
};

export function gatheringIcon(kind: string | null | undefined): string {
  return GATHERING_KIND_ICON[(kind as GatheringKind)] ?? GATHERING_KIND_ICON.other;
}

/** A one-off family simcha (wedding, bar/bat mitzvah, brit, …) — not recurring. */
export interface Gathering {
  id: number;
  title: string;
  kind: GatheringKind;
  gather_date: string;        // 'YYYY-MM-DD'
  gather_time: string | null; // 'HH:MM' (24h) or null for all-day
  location: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** Set ONLY in combined (merged) view — which family this occurrence belongs to. */
  family?: FamilyTag;
}

/** An accepted alternate spelling of a family-branch surname (editable in-app). */
export interface BranchSpelling {
  id: number;
  branch: string;
  spelling: string;
}

export interface Relationship {
  id: number;
  person_id: number;
  related_to: number;
  relation: 'parent' | 'spouse';
}

export interface FamilyTreeNode {
  id: number;
  name: string;
  last_name?: string | null;
  name_he?: string | null;
  maiden_name?: string | null;
  maiden_name_he?: string | null;
  nickname: string | null;
  family_branch: FamilyBranch | null;
  photo_url: string | null;
  /** First/primary spouse — kept for back-compat; equals spouses[0]. */
  spouse?: FamilyTreeNode;
  /** All spouses (remarriage). Rendered as additional partner cards in the row. */
  spouses?: FamilyTreeNode[];
  /**
   * Spouses who are ALSO placed elsewhere in the tree (e.g. a cousin marriage —
   * the partner is a blood relative on another branch, so they render there). We
   * can't draw a second card without duplicating them, so the marriage is shown
   * as a small "⚭ name" reference chip instead of being silently dropped.
   */
  spouseRefs?: { id: number; name: string }[];
  children: FamilyTreeNode[];
  birthday?: { hebrew_day: number; hebrew_month: string; gregorian_year: number | null };
}
