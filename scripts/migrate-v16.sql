-- migrate-v16 — let a family have NO branches at all.
--
-- ── WHY ──
-- v14 gave every family its own ordered branch list and left existing rows NULL,
-- so they keep inheriting the deployment's FAMILY_BRANCHES. That fallback is the
-- right answer for a family that predates per-family branches. It is the WRONG
-- answer for a family created afterwards: an unrelated family signing up on a
-- shared deployment would be handed the operator's real family surnames as their
-- own branch chips — one tenant's personal data showing up inside another's
-- calendar, which is exactly what per-family branches existed to stop.
--
-- So NULL and empty now mean different things, and the difference is privacy:
--
--   NULL  → predates per-family branches; inherit FAMILY_BRANCHES (migration path)
--   {}    → this family has no sides set up yet; nobody is tinted, nothing leaks
--   {…}   → this family's own list
--
-- `createFamilyWithOwner()` stamps `'{}'` on every new family, so from here on the
-- env var reaches only the rows that existed before v14 — a finite, shrinking set.
--
-- v14's CHECK required `cardinality(branches) BETWEEN 1 AND 24`, which rejects the
-- empty array outright. This relaxes the floor to 0 and changes nothing else: no
-- NULL elements, no empty-string elements, at most 24 entries, and a total length
-- that keeps the row well clear of a page. v14 is left exactly as it shipped —
-- it has already run in production, and rewriting an applied migration means the
-- database and the file stop agreeing about history.
--
-- Idempotent: DROP IF EXISTS then ADD, the same shape v14 used.

ALTER TABLE family_calendar.families
  DROP CONSTRAINT IF EXISTS families_branches_check;
ALTER TABLE family_calendar.families
  ADD CONSTRAINT families_branches_check CHECK (
    branches IS NULL OR (
      array_position(branches, NULL) IS NULL
      AND NOT ('' = ANY (branches))
      AND cardinality(branches) BETWEEN 0 AND 24
      AND length(array_to_string(branches, ',')) <= 983
    )
  );

-- No GRANTS and no RLS here, for the reasons spelled out at the end of
-- migrate-v14.sql: `families` is granted at table level, and it is one of the
-- non-RLS tenancy tables because it IS the tenant list.
