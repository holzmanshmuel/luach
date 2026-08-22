-- scripts/migrate-v13.sql — per-family iCal feed tokens.
--
-- Until now /api/calendar.ics was gated by ONE shared ICAL_TOKEN env var, handed
-- to every signed-in user, with the tenant chosen by a `?family=<id>` query
-- param. Anyone holding a feed URL could swap the id and read any other family's
-- calendar — a cross-tenant read RLS never saw, because the ROUTE chose the
-- tenant rather than the credential doing it. This migration gives every family
-- its own unguessable feed token: the token now IDENTIFIES the family, so there
-- is no selector to tamper with and no master key to leak.
--
-- Safe to re-run (every step is guarded / idempotent).

-- gen_random_bytes() lives in pgcrypto. (gen_random_uuid() has been core since
-- PG13, but the raw-bytes generator still needs the extension.)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add the column NULLABLE first so the backfill below can run on a live table
--    without a rewrite that would need a default for the not-yet-existing rows.
ALTER TABLE family_calendar.families
  ADD COLUMN IF NOT EXISTS feed_token TEXT;

-- 2. Backfill every existing family with 24 random bytes (192 bits) hex-encoded
--    -> a 48-char token. Evaluated PER ROW, so no two families share one.
UPDATE family_calendar.families
   SET feed_token = encode(gen_random_bytes(24), 'hex')
 WHERE feed_token IS NULL;

-- 3. New families get a token automatically. Deliberately a column DEFAULT, not
--    app code: createFamilyWithOwner() (src/lib/users.ts) never mentions
--    feed_token, so onboarding cannot forget to mint one — and no future INSERT
--    path can either. The default expression is stored parsed (pgcrypto's OID,
--    not the bare name), so it resolves regardless of the caller's search_path.
ALTER TABLE family_calendar.families
  ALTER COLUMN feed_token SET DEFAULT encode(gen_random_bytes(24), 'hex');

-- 4. Now that every row has a value and every new row gets one, lock it down.
--    NOT NULL: a family without a token would silently have an unsubscribable
--    calendar. UNIQUE: the token is the whole authorization decision for the
--    feed, so two families must never resolve from one token (and the unique
--    index also makes the lookup an index probe rather than a seq scan).
ALTER TABLE family_calendar.families
  ALTER COLUMN feed_token SET NOT NULL;

ALTER TABLE family_calendar.families
  DROP CONSTRAINT IF EXISTS families_feed_token_key;
ALTER TABLE family_calendar.families
  ADD CONSTRAINT families_feed_token_key UNIQUE (feed_token);

-- GRANTS: intentionally none. `families` was granted to app_user (and
-- app_user_test) at TABLE level — `\dp` shows `app_user=arwd/...` with an empty
-- "Column privileges" column — and table-level privileges automatically cover
-- columns added later. Same reason migrate-v10 added family_id to six tables
-- with no re-grant. If a future migration ever narrows these to column-level
-- grants, THAT is when a GRANT belongs here.
--
-- RLS: also intentionally none. `families` is one of the non-RLS tenancy tables
-- (families/users/memberships) the app reads via systemQuery; the feed lookup
-- has to find a family BEFORE any tenant context exists, exactly like
-- getFamilyById() for the invite /join page.
