-- scripts/migrate-v14.sql — per-family branch lists.
--
-- A "branch" is a side of a family (usually a surname); Luach tints avatars, tree
-- cards and timeline entries by it. Until now the list came from ONE
-- deployment-wide `FAMILY_BRANCHES` environment variable — in a multi-tenant app
-- that is a tenancy defect, not just an inconvenience: the second, unrelated
-- family to create a calendar on the same deployment was shown the FIRST
-- family's surnames as their branch chips, with no way to change them. This
-- migration moves the list onto the family row, so each tenant owns its own.
--
-- WHY TEXT[] AND NOT A CHILD TABLE OR JSONB
--   The list is short (a handful of entries), read whole on nearly every render,
--   never joined against, and its ORDER is load-bearing — a branch's colour is
--   its position in the list (see src/lib/branches.ts). A `branch_order` child
--   table would need a second query plus an ORDER BY on every page render, and
--   would let two rows claim one position. JSONB would need a shape check to stop
--   `{"a":1}` landing in a list column. A TEXT[] is ordered by construction,
--   arrives from `pg` as a plain JS string[], and is rewritten atomically as one
--   value — which is exactly the edit the admin page performs (save the whole
--   ordered list, never a single element). The values are display strings, not
--   keys: `family_members.family_branch` stays a free TEXT column with no FK, so
--   renaming a branch here cannot orphan or cascade anything.
--
-- WHY NO BACKFILL — DELIBERATELY LEFT NULL
--   NULL means "this family has not chosen", and the app then falls back to
--   `FAMILY_BRANCHES` and finally to the built-in demo list (resolveBranches() in
--   src/lib/branches.ts). So the existing production family and every
--   single-family self-hoster keep their exact current list with ZERO data
--   migration, and only a family that actively sets its own list diverges. A
--   backfill would instead freeze today's env value into every row, quietly
--   breaking the self-hoster who later edits the variable.
--
-- Safe to re-run (every step is guarded / idempotent).

-- 1. The column. Nullable with no DEFAULT, on purpose: see "WHY NO BACKFILL".
--    A brand-new family also starts NULL and inherits the deployment default,
--    which is what a self-hoster running one family wants out of the box.
ALTER TABLE family_calendar.families
  ADD COLUMN IF NOT EXISTS branches TEXT[];

-- 2. Shape guard. The app sanitizes before writing (validateBranchList in
--    src/lib/branches-server.ts: trim, drop blanks, reject duplicates, cap the
--    count and each name's length), but the app is not the only thing that can
--    reach this column — psql, a future script, a half-finished migration. So the
--    database asserts the invariants that would produce a BROKEN list rather than
--    merely an ugly one. NULL (unset) always passes; that is the normal state.
--
--      • no NULL element — `indexOf` finds a JS `null` nowhere, so such an entry
--        occupies a colour slot while rendering as an empty chip nobody can pick
--      • no empty-string element — same, and it cannot be typed in the UI
--      • 1..24 elements, and ≤ 983 characters serialized — an "absurd length"
--        bound on the value as a whole. 983 is not arbitrary: it is exactly the
--        worst case the app allows, 24 names x 40 characters plus 23 commas.
--
--    Deliberately NOT asserted here, because a CHECK constraint cannot contain a
--    subquery and therefore cannot iterate an array element-by-element (no
--    `unnest`, no per-element `length`): each name's own length, whitespace-only
--    names, uniqueness, and the "last entry is the catch-all" convention. Those
--    are validateBranchList()'s job, and none of them BREAKS a read — a duplicate
--    is harmless (indexOf keeps the first position, so no colour moves), a
--    whitespace-only name renders as a blank chip, an over-long one just wraps.
--    The keep-them-in-step gate is a test: branches-server.test.ts asserts the
--    numbers below still match MAX_BRANCHES / MAX_BRANCH_NAME_LENGTH in
--    src/lib/branches.ts, so editing one and forgetting the other fails the suite.
ALTER TABLE family_calendar.families
  DROP CONSTRAINT IF EXISTS families_branches_check;
ALTER TABLE family_calendar.families
  ADD CONSTRAINT families_branches_check CHECK (
    branches IS NULL OR (
      array_position(branches, NULL) IS NULL
      AND NOT ('' = ANY (branches))
      AND cardinality(branches) BETWEEN 1 AND 24
      AND length(array_to_string(branches, ',')) <= 983
    )
  );

-- GRANTS: intentionally none, for the same reason migrate-v13 added feed_token
-- without one. `families` is granted to app_user (and app_user_test) at TABLE
-- level — `\dp` shows `app_user=arwd/...` with an empty "Column privileges"
-- column — and table-level privileges automatically cover columns added later.
--
-- RLS: intentionally none, and there is nothing to add. `families` is one of the
-- three non-RLS tenancy tables (families/users/memberships): it has no
-- `family_id` to scope by, it IS the tenant list, and it must be readable before
-- any tenant context exists (the feed-token lookup and the invite /join page both
-- need a family BEFORE they can enter it). So no policy governs this column, and
-- pretending otherwise would be worse than saying so plainly.
--
-- What isolates the column instead is the WRITE PATH, which is structural rather
-- than advisory: setFamilyBranches() (src/lib/branches-server.ts) runs through
-- the tenant-scoped query() and selects its row with
--
--     WHERE id = nullif(current_setting('app.current_family', true), '')::int
--
-- so the row it updates is chosen by the request's tenant GUC — the same GUC
-- every RLS policy in this schema reads — and NOT by a caller-supplied id. There
-- is no parameter through which one family could name another's row, and
-- query() throws outright when no tenant context has been established. The
-- server action on top of that re-verifies live owner membership
-- (requireAdmin()). Cross-family isolation of this column is tested end-to-end in
-- src/lib/branches-server.test.ts.
