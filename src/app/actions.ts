'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { query, withTransaction } from '@/lib/db';
import { withAuth, withEditor, withDeleter } from '@/lib/auth';
import { HEBREW_MONTHS, EventType, FamilyMember, Gathering, GatheringKind, GATHERING_KINDS, BranchSpelling } from '@/lib/types';
import { namedBranches } from '@/lib/branches';
import { familyBranches } from '@/lib/branches-server';
import { getViewerSpelling, rewriteNames } from '@/lib/spellings';
import { exactGregorianToHebrew } from '@/lib/hebrew';
import { idsMatchingFullName, splitFullName } from '@/lib/names';
import { getT, type Lang } from '@/lib/translations';
import { getGatheringsRaw } from '@/lib/calendar-data';

/**
 * A lang-aware error translator for these server actions, so validation messages
 * surface in Hebrew for a Hebrew user (they were English before). Returns a
 * function that resolves an `err.*` key (with {name}/{type} interpolation).
 */
async function errT(): Promise<(key: string, vars?: Record<string, string>) => string> {
  const lang: Lang = (await cookies()).get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  return (key, vars) => {
    let s = t(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  };
}

/*
 * ── EVERY ACTION BELOW RUNS ITS BODY INSIDE withEditor/withDeleter/withAuth ──
 *
 * Not a style choice. A bare `await requireEditor()` followed by `query()` throws
 * "No tenant context: query() called without an active family." in a Server Action:
 * the guard's enterTenant() does not survive the guard resolving back here, because
 * React cache() only memoizes during a RENDER and enterWith() binds only the
 * callee's continuation. The wrappers use runWithTenant(), which wraps the whole
 * body. Full explanation in src/lib/auth.ts; proof in src/lib/tenant-runtime.test.ts.
 *
 * The same applies to withTransaction(): it reads the tenant when it opens the
 * transaction, so it has to be called from INSIDE the callback, never around it.
 */

/**
 * Which of `ids` are NOT people in the caller's own family. The lookup is a
 * tenant-scoped query(), so another family's member simply does not come back.
 *
 * ⚠️ Needed because RLS is not enough here. Postgres checks a FOREIGN KEY with RLS
 * BYPASSED, so `INSERT INTO relationships (person_id, related_to, …)` naming
 * another family's member id SUCCEEDS: the new row's own family_id is scoped, but
 * the id it points AT is not. That handed anyone two things — an oracle for whether
 * a member id exists anywhere on the deployment (the insert succeeds or fails), and
 * a row in family A that family B silently cascade-deleted by removing their own
 * member. Callers reject the whole action when this returns anything, so a genuine
 * bug surfaces instead of a quietly dropped id.
 */
async function notInThisFamily(ids: number[]): Promise<number[]> {
  const wanted = [...new Set(ids)];
  // A value that isn't a positive integer is not one of our people either, and
  // must not reach the query as a parameter (`= ANY($1)` would raise instead).
  const malformed = wanted.filter(id => !Number.isInteger(id) || id <= 0);
  const lookup = wanted.filter(id => Number.isInteger(id) && id > 0);
  if (lookup.length === 0) return malformed;
  const rows = await query<{ id: number }>(
    'SELECT id FROM family_calendar.family_members WHERE id = ANY($1)',
    [lookup]
  );
  const mine = new Set(rows.map(r => r.id));
  return [...malformed, ...lookup.filter(id => !mine.has(id))];
}

export interface EventFormData {
  name: string;
  family_member_id?: number;   // when known (e.g. just-created person), link by id not name
  family_branch: string;
  event_type: EventType;
  event_type_label?: string;   // for 'other' type
  hebrew_day: number;
  hebrew_month: string;
  gregorian_year?: number;     // the year the event occurred (for display + initial conversion)
  original_english_date?: string;
  /**
   * When true, the Hebrew recurrence is (re)derived from original_english_date on
   * the server (the user just edited the English date). When false/absent, the
   * provided hebrew_day/month are used AS-IS and any original_english_date is
   * stored unchanged — so editing the Hebrew date directly doesn't wipe the stored
   * English birth date, and a no-op save never re-derives (and never shifts).
   */
  deriveFromEnglish?: boolean;
  note?: string;
}

const VALID_EVENT_TYPES: EventType[] = ['birthday', 'anniversary', 'yahrtzeit', 'other'];

/** Returns an `err.*` key (translated by the caller) or null. */
function validateEventForm(data: EventFormData): string | null {
  if (!data.name.trim()) return 'err.name_required';
  if (!data.event_type || !VALID_EVENT_TYPES.includes(data.event_type)) return 'err.event_type_required';
  if (data.event_type === 'other' && !data.event_type_label?.trim()) return 'err.describe_event';
  return null;
}

/**
 * Resolve the authoritative recurring Hebrew date for an event.
 *
 * When an English date is supplied it is the source of truth: the Hebrew date is
 * (re)derived from it HERE on the server, so a stale or missing client-side
 * conversion can never be saved — the recurring date always matches the English
 * date the user actually entered. Without an English date, the Hebrew day/month
 * entered directly are used (and validated). Returns the resolved date, or an
 * `error` string for the caller to surface.
 */
function resolveEventDate(
  data: EventFormData
): { hebrew_day: number; hebrew_month: string } | { errorKey: string } {
  // Derive the Hebrew recurrence from the English date ONLY when the user actually
  // edited the English date. Otherwise the provided hebrew_day/month win (a direct
  // Hebrew edit, or an unchanged no-op save), so we never override a manual Hebrew
  // date or shift a legacy date on save.
  if (data.deriveFromEnglish && data.original_english_date) {
    const m = data.original_english_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { errorKey: 'err.date_invalid' };
    const [yy, mo, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (yy < 1800 || yy > 2100) return { errorKey: 'err.year_range' };
    // Reject cross-field-invalid dates (Feb 30, Apr 31, Feb 29 in a non-leap year).
    // The regex + per-field min/max let these through, and `new Date(y, m, d)`
    // silently rolls them over (Feb 31 → Mar 3), storing a wrong Hebrew date.
    const probe = new Date(yy, mo - 1, dd);
    if (probe.getFullYear() !== yy || probe.getMonth() !== mo - 1 || probe.getDate() !== dd) {
      return { errorKey: 'err.date_nonexistent' };
    }
    const heb = exactGregorianToHebrew(mo, dd, yy);
    if (!heb) return { errorKey: 'err.hebrew_from_english' };
    return { hebrew_day: heb.day, hebrew_month: heb.month };
  }
  if (!data.hebrew_day || data.hebrew_day < 1 || data.hebrew_day > 30) {
    return { errorKey: 'err.hebrew_day' };
  }
  if (!data.hebrew_month || !(HEBREW_MONTHS as readonly string[]).includes(data.hebrew_month)) {
    return { errorKey: 'err.hebrew_month' };
  }
  return { hebrew_day: data.hebrew_day, hebrew_month: data.hebrew_month };
}

export async function createEventAction(
  data: EventFormData
): Promise<{ error?: string }> {
  return withEditor(async () => {
    const T = await errT();

    const error = validateEventForm(data);
    if (error) return { error: T(error) };

    const resolved = resolveEventDate(data);
    if ('errorKey' in resolved) return { error: T(resolved.errorKey) };

    // Find or create family member. Prefer an explicit id (e.g. the person we just
    // created in the Add-Person flow, or one picked from the suggestions) so we never
    // mis-link via a name lookup. Every lookup here is tenant-scoped, so an id from
    // another family finds nothing and falls through to creating a new person here —
    // it can never be linked.
    let memberId: number | undefined;
    if (data.family_member_id) {
      const rows = await query<{ id: number }>(
        'SELECT id FROM family_calendar.family_members WHERE id = $1',
        [data.family_member_id]
      );
      memberId = rows[0]?.id;
    } else {
      // The form collects a FULL name, so match it against each person's full name —
      // the same fullName() the form's suggestion list shows — both as stored and as
      // this viewer spells the family's surnames. This used to compare the typed full
      // name with the given-name column alone, which never matched a person who has a
      // surname: "Miriam Cohen" created a second Miriam, splitting her occasions
      // across two people in the tree.
      const people = await query<{ id: number; name: string; last_name: string | null; family_branch: string | null }>(
        'SELECT id, name, last_name, family_branch FROM family_calendar.family_members'
      );
      const respelled = rewriteNames(people.map(p => ({ ...p })), await getViewerSpelling());
      const ids = idsMatchingFullName([...people, ...respelled], data.name);
      if (ids.length > 1) {
        // Two people answer to this name. Picking one would attach the occasion to
        // the wrong person without a trace; the suggestion list can tell them apart.
        return { error: T('err.person_ambiguous', { name: data.name.trim() }) };
      }
      memberId = ids[0];
      // Do NOT overwrite an existing person's branch from an event entry — branch is
      // a person attribute managed in the family tree, not something an event should
      // silently re-categorise.
    }

    if (memberId === undefined) {
      // Creating a brand-new person from a single typed name — split off the surname
      // (last word) so they get a proper last_name like everyone else.
      const { given, last } = splitFullName(data.name);
      const result = await query<{ id: number }>(
        'INSERT INTO family_calendar.family_members (name, last_name, family_branch) VALUES ($1, $2, $3) RETURNING id',
        [given || data.name.trim(), last, data.family_branch || null]
      );
      memberId = result[0].id;
    }

    // Allow multiple events of the same type only for 'other' and 'yahrtzeit'
    if (data.event_type === 'birthday' || data.event_type === 'anniversary') {
      const existing = await query(
        'SELECT id FROM family_calendar.events WHERE family_member_id = $1 AND event_type = $2',
        [memberId, data.event_type]
      );
      if (existing.length > 0) {
        return { error: T('err.dup_event', { name: data.name.trim() }) };
      }
    }

    await query(
      `INSERT INTO family_calendar.events
       (family_member_id, event_type, event_type_label, hebrew_day, hebrew_month,
        gregorian_year, original_english_date, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        memberId,
        data.event_type,
        data.event_type_label || null,
        resolved.hebrew_day,
        resolved.hebrew_month,
        data.gregorian_year || null,
        data.original_english_date || null,
        data.note || null,
      ]
    );

    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

export async function updateEventAction(
  eventId: number,
  data: EventFormData
): Promise<{ error?: string }> {
  return withEditor(async () => {
    const T = await errT();

    const error = validateEventForm(data);
    if (error) return { error: T(error) };

    const resolved = resolveEventDate(data);
    if ('errorKey' in resolved) return { error: T(resolved.errorKey) };

    const events = await query<{ family_member_id: number }>(
      'SELECT family_member_id FROM family_calendar.events WHERE id = $1',
      [eventId]
    );
    if (events.length === 0) return { error: T('err.event_not_found') };

    const memberId = events[0].family_member_id;
    // Editing an event's Name renames the PERSON (one name across all their events).
    // Guard against colliding with another member — a duplicate name silently
    // corrupts the name-based event linking and merges two people in the UI.
    const nameClash = await query<{ id: number }>(
      'SELECT id FROM family_calendar.family_members WHERE LOWER(name) = LOWER($1) AND id <> $2',
      [data.name.trim(), memberId]
    );
    if (nameClash.length > 0) {
      return { error: T('err.name_clash', { name: data.name.trim() }) };
    }
    // Keep the person's name in sync, but never touch their branch from an event
    // edit — that's managed in the tree.
    await query(
      'UPDATE family_calendar.family_members SET name = $1, updated_at = NOW() WHERE id = $2',
      [data.name.trim(), memberId]
    );

    await query(
      `UPDATE family_calendar.events SET
       event_type = $1, event_type_label = $2, hebrew_day = $3, hebrew_month = $4,
       gregorian_year = $5, original_english_date = $6, note = $7, updated_at = NOW()
       WHERE id = $8`,
      [
        data.event_type,
        data.event_type_label || null,
        resolved.hebrew_day,
        resolved.hebrew_month,
        data.gregorian_year || null,
        data.original_english_date || null,
        data.note || null,
        eventId,
      ]
    );

    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

export async function deleteEventAction(eventId: number): Promise<{ error?: string }> {
  return withDeleter(async () => {
    const events = await query<{ family_member_id: number }>(
      'SELECT family_member_id FROM family_calendar.events WHERE id = $1',
      [eventId]
    );
    if (events.length === 0) return { error: (await errT())('err.event_not_found') };

    // Delete ONLY the event. Never cascade-delete the person — that used to wipe the
    // whole family-tree record (and detach their children) when you removed someone's
    // last event. People are removed deliberately from the family tree instead.
    await query('DELETE FROM family_calendar.events WHERE id = $1', [eventId]);

    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

export async function createPersonAction(data: {
  name: string;
  last_name?: string;
  family_branch: string;
  parent_ids: number[];
  spouse_id?: number;
  nickname?: string;
  maiden_name?: string;
  notifications_enabled?: boolean;
}): Promise<{ error?: string; id?: number }> {
  return withEditor(async () => {
    const T = await errT();
    if (!data.name.trim()) return { error: T('err.name_required') };

    // Same given name AND surname = already exists.
    const last = data.last_name?.trim() || '';
    const existing = await query<{ id: number }>(
      "SELECT id FROM family_calendar.family_members WHERE LOWER(name) = LOWER($1) AND LOWER(COALESCE(last_name,'')) = LOWER($2)",
      [data.name.trim(), last]
    );
    if (existing.length > 0) {
      return { error: T('err.person_exists', { name: `${data.name.trim()} ${last}`.trim() }) };
    }

    // Every id the client sent must be one of OUR people before it is written into
    // a relationship row — the FK alone does not check that (see notInThisFamily).
    const linked = [...data.parent_ids, ...(data.spouse_id ? [data.spouse_id] : [])];
    if ((await notInThisFamily(linked)).length > 0) {
      return { error: T('err.unknown_person') };
    }

    // Member row + relationship rows in one transaction, so a failure can't leave a
    // nameless-event orphan or a half-attached spouse.
    const newId = await withTransaction(async (run) => {
      // notifications_enabled is set explicitly on every create: the DB column
      // default is TRUE (scripts/migrate-v3.sql) but is intentionally always
      // overridden here — consent fails CLOSED, so no submitted value = no nudges.
      const result = await run<{ id: number }>(
        'INSERT INTO family_calendar.family_members (name, last_name, family_branch, nickname, maiden_name, notifications_enabled) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [data.name.trim(), data.last_name?.trim() || null, data.family_branch || null, data.nickname?.trim() || null, data.maiden_name?.trim() || null, data.notifications_enabled ?? false]
      );
      const id = result[0].id;

      for (const parentId of data.parent_ids) {
        await run(
          'INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [parentId, id, 'parent']
        );
      }

      if (data.spouse_id) {
        // Just add the marriage (bidirectional). We do NOT detach the chosen spouse's
        // other marriages — remarriage is a valid, now-rendered state, and detaching
        // would silently divorce a third party who isn't part of this edit.
        await run(
          'INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, data.spouse_id, 'spouse']
        );
        await run(
          'INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [data.spouse_id, id, 'spouse']
        );
      }
      return id;
    });

    revalidatePath('/');
    revalidatePath('/tree');
    return { id: newId };
  });
}

export async function getAllFamilyMembers(): Promise<FamilyMember[]> {
  // Returns phone_e164 etc., so it must require a session like its siblings —
  // server-action endpoints are otherwise callable unauthenticated.
  return withAuth(async () => {
    const rows = await query<FamilyMember>(
      'SELECT * FROM family_calendar.family_members ORDER BY last_name NULLS LAST, name'
    );
    return rewriteNames(rows, await getViewerSpelling());
  });
}

export async function getPersonById(id: number): Promise<FamilyMember | null> {
  return withAuth(async () => {
    const rows = await query<FamilyMember>(
      'SELECT * FROM family_calendar.family_members WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  });
}

export async function getPersonRelationships(personId: number): Promise<{
  parentIds: number[];
  spouseIds: number[];
}> {
  return withAuth(async () => {
    const [parentRows, spouseRows] = await Promise.all([
      // parent_id → child: find rows where this person is the child
      query<{ person_id: number }>(
        "SELECT person_id FROM family_calendar.relationships WHERE related_to = $1 AND relation = 'parent'",
        [personId]
      ),
      // ALL spouses (remarriage → many). Spouse rows are bidirectional, so person_id
      // = this person gives every partner via related_to.
      query<{ related_to: number }>(
        "SELECT related_to FROM family_calendar.relationships WHERE person_id = $1 AND relation = 'spouse'",
        [personId]
      ),
    ]);

    return {
      parentIds: parentRows.map(r => r.person_id),
      spouseIds: spouseRows.map(r => r.related_to),
    };
  });
}

export async function updatePersonRelationshipsAction(data: {
  personId: number;
  parentIds: number[];
  spouseIds: number[];
}): Promise<{ error?: string }> {
  return withEditor(async () => {
    // The person being edited AND everyone the client wants linked to them must be
    // people in THIS family. Checked before anything is written, because the FK on
    // relationships is evaluated with RLS bypassed — see notInThisFamily.
    const referenced = [data.personId, ...data.parentIds, ...data.spouseIds];
    if ((await notInThisFamily(referenced)).length > 0) {
      return { error: (await errT())('err.unknown_person') };
    }

    // Reject a parent choice that would create an ancestry cycle (picking a
    // descendant as a parent) — a cycle makes the whole branch vanish from the tree.
    const cycle = await parentChoiceMakesCycle(data.personId, data.parentIds);
    if (cycle) return { error: (await errT())(cycle) };

    await withTransaction(async (run) => {
      // Parents (rows where this person is the child) — replace wholesale; only
      // affects this person's own parent edges.
      await run(
        "DELETE FROM family_calendar.relationships WHERE related_to = $1 AND relation = 'parent'",
        [data.personId]
      );
      for (const parentId of data.parentIds) {
        await run(
          "INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, 'parent') ON CONFLICT DO NOTHING",
          [parentId, data.personId]
        );
      }

      // Spouses (bidirectional, one-to-many for remarriage). DIFF against the current
      // set: remove only the marriages the user removed, add only new ones. Do NOT
      // delete-all-then-insert (that destroyed a second marriage) and do NOT detach a
      // chosen spouse's OTHER marriages (that silently divorced a third party).
      const existing = (await run<{ related_to: number }>(
        "SELECT related_to FROM family_calendar.relationships WHERE person_id = $1 AND relation = 'spouse'",
        [data.personId]
      )).map(r => r.related_to);
      const desired = new Set(data.spouseIds);
      for (const sid of existing.filter(id => !desired.has(id))) {
        await run(
          "DELETE FROM family_calendar.relationships WHERE relation = 'spouse' AND ((person_id = $1 AND related_to = $2) OR (person_id = $2 AND related_to = $1))",
          [data.personId, sid]
        );
      }
      for (const sid of data.spouseIds.filter(id => !existing.includes(id))) {
        await run(
          "INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, 'spouse') ON CONFLICT DO NOTHING",
          [data.personId, sid]
        );
        await run(
          "INSERT INTO family_calendar.relationships (person_id, related_to, relation) VALUES ($1, $2, 'spouse') ON CONFLICT DO NOTHING",
          [sid, data.personId]
        );
      }
    });

    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

/**
 * Returns an error string if making `parentIds` the parents of `personId` would
 * create an ancestry cycle (i.e. one of the chosen parents is `personId` itself
 * or a descendant of it). Walks DOWN from `personId` through child edges.
 */
async function parentChoiceMakesCycle(personId: number, parentIds: number[]): Promise<string | null> {
  if (parentIds.includes(personId)) return 'err.self_parent';
  if (parentIds.length === 0) return null;

  const edges = await query<{ person_id: number; related_to: number }>(
    "SELECT person_id, related_to FROM family_calendar.relationships WHERE relation = 'parent'"
  );
  // Map parent -> children (parent row is person_id=parent, related_to=child).
  const childrenOf = new Map<number, number[]>();
  for (const e of edges) {
    const arr = childrenOf.get(e.person_id) ?? [];
    arr.push(e.related_to);
    childrenOf.set(e.person_id, arr);
  }
  // Collect all descendants of personId.
  const descendants = new Set<number>();
  const stack = [...(childrenOf.get(personId) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (descendants.has(n)) continue;
    descendants.add(n);
    for (const c of childrenOf.get(n) ?? []) stack.push(c);
  }
  const bad = parentIds.find(p => descendants.has(p));
  if (bad !== undefined) return 'err.parent_cycle';
  return null;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;

export async function updatePersonAction(data: {
  id: number;
  name: string;
  last_name?: string;
  family_branch: string;
  nickname?: string;
  maiden_name?: string;
  phone_e164?: string;
  notifications_enabled?: boolean;
}): Promise<{ error?: string }> {
  return withEditor(async () => {
    const T = await errT();
    if (!data.name.trim()) return { error: T('err.name_required') };

    const phone = data.phone_e164?.trim() || null;
    if (phone && !E164_RE.test(phone)) {
      return { error: T('err.phone_format') };
    }

    // Clash = same given name AND same surname (two "David"s in different families
    // are fine now that the surname is its own field).
    const last = data.last_name?.trim() || '';
    const nameClash = await query<{ id: number }>(
      "SELECT id FROM family_calendar.family_members WHERE LOWER(name) = LOWER($1) AND LOWER(COALESCE(last_name,'')) = LOWER($2) AND id <> $3",
      [data.name.trim(), last, data.id]
    );
    if (nameClash.length > 0) {
      return { error: T('err.name_clash', { name: `${data.name.trim()} ${last}`.trim() }) };
    }

    await query(
      `UPDATE family_calendar.family_members
       SET name = $1, last_name = $2, family_branch = $3, nickname = $4,
           phone_e164 = $5, notifications_enabled = $6, maiden_name = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        data.name.trim(),
        data.last_name?.trim() || null,
        data.family_branch || null,
        data.nickname?.trim() || null,
        phone,
        // Consent fails closed: an absent field must mean "no nudges", never "nudges".
        data.notifications_enabled ?? false,
        data.maiden_name?.trim() || null,
        data.id,
      ]
    );
    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

const MAX_PHOTO_BYTES = 600_000; // ~600KB base64 ≈ 450KB raw after resize
const PHOTO_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export async function updatePersonPhotoAction(data: {
  id: number;
  photoDataUrl: string | null; // null clears the photo
}): Promise<{ error?: string }> {
  return withEditor(async () => {
    if (data.photoDataUrl !== null) {
      const T = await errT();
      if (!PHOTO_DATA_URL_RE.test(data.photoDataUrl)) {
        return { error: T('err.photo_type') };
      }
      if (data.photoDataUrl.length > MAX_PHOTO_BYTES) {
        return { error: T('err.photo_large') };
      }
    }

    await query(
      `UPDATE family_calendar.family_members
       SET photo_url = $1, photo_uploaded_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [data.photoDataUrl, data.photoDataUrl ? new Date() : null, data.id]
    );
    revalidatePath('/');
    revalidatePath('/tree');
    return {};
  });
}

export async function setHebrewNameAction(data: {
  id: number;
  name_he: string;
}): Promise<{ error?: string }> {
  return withEditor(async () => {
    const value = data.name_he.trim();
    await query(
      `UPDATE family_calendar.family_members
       SET name_he = $2, name_he_status = 'confirmed', updated_at = NOW()
       WHERE id = $1`,
      [data.id, value || null]
    );
    revalidatePath('/');
    revalidatePath('/tree');
    revalidatePath('/admin/names');
    return {};
  });
}

// ── Gatherings (one-off family simchas: weddings, bar/bat mitzvahs, britot, …) ─

export interface GatheringFormData {
  title: string;
  kind?: string;                // GatheringKind; defaults to 'other'
  gather_date: string;          // 'YYYY-MM-DD'
  gather_time?: string | null;  // 'HH:MM' or empty
  location?: string | null;
  description?: string | null;
}

function normalizeKind(kind: string | undefined): GatheringKind {
  return GATHERING_KINDS.includes(kind as GatheringKind) ? (kind as GatheringKind) : 'other';
}

function validateGathering(data: GatheringFormData): string | null {
  if (!data.title.trim()) return 'A title is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.gather_date)) return 'A valid date is required.';
  if (data.gather_time && !/^\d{2}:\d{2}$/.test(data.gather_time)) return 'Time must be HH:MM.';
  return null;
}

export async function getGatherings(): Promise<Gathering[]> {
  return withAuth(() => getGatheringsRaw());
}

export async function createGatheringAction(
  data: GatheringFormData
): Promise<{ error?: string; id?: number }> {
  return withEditor(async () => {
    const error = validateGathering(data);
    if (error) return { error };

    const rows = await query<{ id: number }>(
      `INSERT INTO family_calendar.gatherings (title, kind, gather_date, gather_time, location, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        data.title.trim(),
        normalizeKind(data.kind),
        data.gather_date,
        data.gather_time || null,
        data.location?.trim() || null,
        data.description?.trim() || null,
      ]
    );
    revalidatePath('/');
    revalidatePath('/timeline');
    return { id: rows[0].id };
  });
}

export async function updateGatheringAction(
  id: number,
  data: GatheringFormData
): Promise<{ error?: string }> {
  return withEditor(async () => {
    const error = validateGathering(data);
    if (error) return { error };

    await query(
      `UPDATE family_calendar.gatherings
       SET title = $2, kind = $3, gather_date = $4, gather_time = $5, location = $6,
           description = $7, updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        data.title.trim(),
        normalizeKind(data.kind),
        data.gather_date,
        data.gather_time || null,
        data.location?.trim() || null,
        data.description?.trim() || null,
      ]
    );
    revalidatePath('/');
    revalidatePath('/timeline');
    return {};
  });
}

export async function deleteGatheringAction(id: number): Promise<{ error?: string }> {
  return withDeleter(async () => {
    await query('DELETE FROM family_calendar.gatherings WHERE id = $1', [id]);
    revalidatePath('/');
    revalidatePath('/timeline');
    return {};
  });
}

// ── Branch name spellings (editable "also spelled" variants per family branch) ─

export async function getBranchSpellings(): Promise<BranchSpelling[]> {
  return withAuth(() =>
    query<BranchSpelling>(
      `SELECT id, branch, spelling FROM family_calendar.branch_spellings
       ORDER BY branch, spelling`
    )
  );
}

export async function addBranchSpellingAction(
  branch: string,
  spelling: string
): Promise<{ error?: string; id?: number }> {
  return withEditor(async () => {
    const b = branch.trim();
    const s = spelling.trim().replace(/\s+/g, ' ');
    // Only a NAMED branch can carry alternate spellings — the catch-all (the last
    // configured branch) has no surname, and an unconfigured value is not ours to
    // invent spellings for. Checked against THIS family's list; familyBranches()
    // reads the tenant this callback runs in.
    if (!namedBranches(await familyBranches()).includes(b)) {
      return { error: 'Please choose a family branch.' };
    }
    if (!s) return { error: 'Please enter a spelling.' };
    if (s.length > 60) return { error: 'That spelling is too long.' };
    const rows = await query<{ id: number }>(
      `INSERT INTO family_calendar.branch_spellings (branch, spelling)
       VALUES ($1, $2)
       ON CONFLICT (branch, spelling) DO NOTHING
       RETURNING id`,
      [b, s]
    );
    revalidatePath('/tree');
    revalidatePath('/');
    return { id: rows[0]?.id };
  });
}

export async function deleteBranchSpellingAction(id: number): Promise<{ error?: string }> {
  return withDeleter(async () => {
    await query('DELETE FROM family_calendar.branch_spellings WHERE id = $1', [id]);
    revalidatePath('/tree');
    revalidatePath('/');
    return {};
  });
}
