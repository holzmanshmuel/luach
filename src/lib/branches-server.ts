import { cache } from 'react';
import { query, systemQuery } from '@/lib/db';
import { getFamilyId } from '@/lib/tenant';
import {
  resolveBranches,
  sanitizeBranchList,
  MAX_BRANCHES,
  MAX_BRANCH_NAME_LENGTH,
} from '@/lib/branches';

/**
 * The branch list for ONE family — the tenant-aware read, and the only write.
 *
 * ── WHY THIS IS NOT AN ENVIRONMENT READ ANY MORE ──
 * `FAMILY_BRANCHES` is a single deployment-wide value, but Luach is multi-tenant:
 * every family on a deployment used to see the same branch chips, so the second
 * unrelated family to sign up inherited the first family's surnames. The list now
 * lives on the family row (`families.branches`, migrate-v14) and the env var is
 * only the FALLBACK — which is what keeps the existing production family and
 * every single-family self-hoster working with no data migration.
 *
 * Resolution order (the chain itself is pure — `resolveBranches` in branches.ts):
 *   the family's own stored list → `FAMILY_BRANCHES` → `DEFAULT_FAMILY_BRANCHES`
 *
 * Deliberately NOT `NEXT_PUBLIC_*` / not read in the browser: `NEXT_PUBLIC_`
 * values are inlined into the bundle during `next build` and frozen there, and a
 * per-family value could not be inlined at all. Server components, server
 * actions, route handlers and the CLI scripts call this; CLIENT components must
 * NOT — they read `branches` from `useUserPrefs()`, which the root layout fills
 * from here (see `src/app/layout.tsx` and `UserPrefsProvider`). The guard below
 * turns that mistake into an immediate error instead of a wrong-colours mystery.
 */

/**
 * Is this error Postgres' "column does not exist" (SQLSTATE 42703)?
 *
 * Exported so the decision is unit-testable without a deliberately broken
 * database. Matched on the SQLSTATE code, never on the message text — messages
 * are localised and reworded between server versions.
 */
export function isUndefinedColumn(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42703';
}

/**
 * A family's OWN stored list, or null when it has never set one (the state
 * migrate-v14 deliberately leaves every existing row in). Not the resolved
 * list — callers wanting the resolved one want {@link familyBranches}. Exported
 * because `/admin/branches` needs to tell an owner whether they are looking at
 * their own list or at the deployment default they have inherited.
 *
 * `families` is one of the non-RLS tenancy tables, so this is a `systemQuery`
 * keyed by an explicit id — the same discipline as `feed-token.ts` and
 * `users.ts`. Memoized per request (React `cache`), because the root layout and
 * the page below it both resolve the list on a single render; outside a request
 * `cache()` is a pass-through, so scripts and tests see every call.
 */
export const storedFamilyBranches = cache(
  async (familyId: number): Promise<string[] | null> => {
    try {
      const rows = await systemQuery<{ branches: string[] | null }>(
        'SELECT branches FROM family_calendar.families WHERE id = $1',
        [familyId]
      );
      return rows[0]?.branches ?? null;
    } catch (err) {
      // ── Why this catch exists ──
      // `families.branches` arrives in migrate-v14, and this function is called
      // from the ROOT LAYOUT — so on a deployment whose code is live but whose
      // migration has not been run yet, an unguarded query throws
      // `undefined_column` and EVERY signed-in page 500s. That is not
      // hypothetical: it happened once, in production, in the minute between a
      // push and the migration.
      //
      // A missing column and a NULL column mean the same thing to the caller —
      // "this family has not chosen a list" — so answering `null` degrades
      // exactly into the env-var fallback the resolution chain already has, and
      // self-heals the moment the migration lands. Deploy order stops mattering.
      //
      // Deliberately narrow: ONLY Postgres 42703 (undefined_column) is absorbed.
      // Every other failure — connection, permission, a genuinely broken query —
      // rethrows, because silence about those is how a real outage hides.
      if (isUndefinedColumn(err)) {
        return null;
      }
      throw err;
    }
  }
);

/**
 * The resolved, ordered branch list for a family.
 *
 * `familyId` defaults to the ACTIVE tenant — the family the current request has
 * entered via `enterTenant()` (i.e. after `establishTenant()` / `requireAuth()` /
 * `requireAdmin()`), or the one a `runWithTenant()` callback names. With no
 * tenant at all — a signed-out visitor rendering the root layout, a script — it
 * resolves the deployment default, which is exactly the old behaviour.
 *
 * Pass an explicit id for the machine callers that act on a family they were
 * given rather than one they are "in" (n8n fan-out, the CSV importer).
 */
export async function familyBranches(familyId?: number | null): Promise<string[]> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'familyBranches() is server-side only — the branch list is per-family data ' +
      'read from Postgres, not something the browser bundle can see. ' +
      'In a client component read `branches` from useUserPrefs() instead.'
    );
  }
  const id = familyId ?? getFamilyId();
  const stored = id == null ? null : await storedFamilyBranches(id);
  return resolveBranches(stored, process.env.FAMILY_BRANCHES);
}

/** Why a proposed branch list was rejected, in words an owner can act on. */
export type BranchListProblem = string;

/**
 * Validate + clean a proposed list. PURE-ish (no I/O) and shared by the server
 * action and its tests, so the rules cannot drift between them.
 *
 * Returns the sanitized list on success. Guards, in the order an owner hits them:
 * either none at all (a new family sorts nobody by side) or at least two (one
 * real branch plus the catch-all — a one-entry list is nothing but a catch-all);
 * no absurd count or length; no duplicates, INCLUDING ones that differ only in case or
 * spacing, because two chips reading the same word is indistinguishable from a
 * bug. Duplicates are reported rather than silently collapsed: silently dropping
 * one shifts every later entry's position, and position is colour.
 */
export function validateBranchList(
  proposed: readonly string[]
): { branches: string[] } | { error: BranchListProblem } {
  const raw = (proposed ?? []).map(s => (s ?? '').trim().replace(/\s+/g, ' '));

  if (raw.length > MAX_BRANCHES) {
    return { error: `That is more than ${MAX_BRANCHES} branches. Keep the list to the sides your family actually has.` };
  }
  if (raw.some(s => !s)) {
    return { error: 'Every branch needs a name. Fill the blank one in, or remove it.' };
  }
  const tooLong = raw.find(s => s.length > MAX_BRANCH_NAME_LENGTH);
  if (tooLong) {
    return { error: `"${tooLong.slice(0, MAX_BRANCH_NAME_LENGTH)}…" is too long — keep branch names under ${MAX_BRANCH_NAME_LENGTH} characters.` };
  }
  const seen = new Map<string, string>();
  for (const name of raw) {
    const key = name.toLocaleLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      return { error: `"${name}" is listed twice${first === name ? '' : ` (as "${first}")`}. Each branch needs its own name.` };
    }
    seen.set(key, name);
  }
  // Cleaning is now a no-op given the checks above, but run it so the value
  // written is always the sanitized shape the resolver expects.
  const branches = sanitizeBranchList(raw);
  // An EMPTY list is legitimate and is where every new family starts: "we don't
  // sort anyone by side". Everyone renders neutral and nothing leaks. What is not
  // legitimate is a list of exactly one, which is a catch-all with nothing to
  // catch — the single entry would be drawn neutral anyway, so it only looks like
  // a branch that isn't working.
  if (branches.length === 1) {
    return { error: 'One branch on its own does nothing. Add a second — a real side of the family, plus a catch-all last — or remove it to sort nobody by side.' };
  }
  return { branches };
}

/**
 * Replace the ACTIVE family's branch list. The whole ordered list at once —
 * never one element — because order is colour and a partial write could leave a
 * gap or a shifted position.
 *
 * ── HOW THIS IS ISOLATED FROM OTHER FAMILIES ──
 * `families` has no RLS policy (it is the tenant list itself, and has to be
 * readable before any tenant context exists — see migrate-v14's closing note), so
 * isolation here is structural in a different way: the row is selected by the
 * request's tenant GUC, the very same `app.current_family` every RLS policy in
 * this schema reads, and NOT by a caller-supplied id. There is no argument
 * through which one family could name another's row. `query()` sets that GUC and
 * throws when no tenant has been established, so an unscoped call fails closed
 * rather than writing somewhere arbitrary. Callers additionally re-verify live
 * owner membership (`requireAdmin()`).
 *
 * Returns the list as stored. Validate with {@link validateBranchList} first;
 * this asserts rather than reports, since by here the input is trusted.
 */
export async function setFamilyBranches(branches: readonly string[]): Promise<string[]> {
  const checked = validateBranchList(branches);
  if ('error' in checked) throw new Error(checked.error);
  const rows = await query<{ branches: string[] }>(
    `UPDATE family_calendar.families
        SET branches = $1
      WHERE id = nullif(current_setting('app.current_family', true), '')::int
    RETURNING branches`,
    [checked.branches]
  );
  if (rows.length === 0) {
    // The GUC named a family that no longer exists (deleted mid-session).
    throw new Error('No such family — could not save the branch list.');
  }
  return rows[0].branches;
}
