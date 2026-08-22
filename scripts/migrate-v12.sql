-- V12: dedicated surname column. Names were stored as a single "First [Middle]
-- Last" string, which (a) truncated on the narrow tree card, (b) made surname-
-- based sorting impossible, and (c) risked the surname-spelling rewrite touching a
-- first/middle name that happened to match a surname variant. Split into
-- given-names (the existing `name`) + `last_name`. Nullable so the app deploys
-- null-safe (displayName falls back to `name` alone) BEFORE the one-time backfill
-- splits existing names into given + surname.
--
-- (Renamed from the upstream author's migrate-v9.sql to v12 during the
-- multi-family merge: our v9/v10/v11 tenancy migrations already own those numbers
-- and are applied to production. This surname change only ADDs a column to
-- family_members — no table recreation, no interaction with the family_id/RLS work.)
ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS last_name TEXT;
