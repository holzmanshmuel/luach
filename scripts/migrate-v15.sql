-- V15: peek_invite() — the READ-ONLY companion to redeem_invite().
--
-- /join/<token> used to be a GET route handler that redeemed on sight. It is now a
-- landing PAGE that names the family before asking anyone to sign in, and only
-- redeems from a server action posted by that page. To render, the page needs to
-- answer three questions WITHOUT writing anything and WITHOUT a signed-in user:
-- which family is this, what role does the invite grant, and is the link still
-- live? That is what this function is for.
--
-- SECURITY DEFINER for the same reason redeem_invite is: a visitor opening an
-- invite link has no tenant GUC, and the app's DB role is not BYPASSRLS, so a
-- plain SELECT on the RLS-scoped access_tokens table returns nothing. Rather than
-- hand the app ambient RLS-bypass we encapsulate exactly this one read.
--
-- It NEVER writes. In particular it deliberately does NOT stamp last_used_at: a
-- WhatsApp/Telegram link-preview fetch, or a page refresh, must not mark an invite
-- as used — the owner's admin panel would then report activity that never happened.
--
-- It returns the family NAME even for an expired or revoked link, on purpose: the
-- token is 256-bit and unguessable, so whoever presents one was handed it
-- legitimately, and naming the family is what turns a dead end into "ask whoever
-- sent you the <family> link for a new one". An unknown token returns no row at
-- all and the page falls back to the deliberately opaque /join-invalid.
--
-- Idempotent (DROP + CREATE OR REPLACE, guarded grants) — safe to re-run after a
-- git pull, like every other migration here.

-- DROP first: CREATE OR REPLACE cannot change a function's RETURNS TABLE column
-- names. The argument signature is stable, so this stays a no-op on re-run.
DROP FUNCTION IF EXISTS family_calendar.peek_invite(TEXT);
CREATE OR REPLACE FUNCTION family_calendar.peek_invite(p_token_hash TEXT)
RETURNS TABLE (
  out_family_id      INTEGER,
  out_family_name    TEXT,
  out_family_name_he TEXT,
  out_role           TEXT,
  out_status         TEXT   -- 'live' | 'expired' | 'revoked'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = family_calendar, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  SELECT t.family_id,
         f.name,
         f.name_he,
         t.invite_role::TEXT,
         CASE
           -- Revoked beats expired: an owner who turned a link off should be told
           -- it was turned off, even if it had also aged out.
           WHEN t.revoked_at IS NOT NULL                           THEN 'revoked'
           WHEN t.expires_at IS NOT NULL AND t.expires_at <= NOW() THEN 'expired'
           ELSE 'live'
         END
    FROM family_calendar.access_tokens t
    JOIN family_calendar.families f ON f.id = t.family_id
   WHERE t.token_hash = p_token_hash
     AND t.kind = 'invite'   -- a shared/personal card token is NOT an invite
   LIMIT 1;
END;
$fn$;

-- Only the app roles need to call it; revoke the public default then grant.
-- app_user_test is what the DB-backed vitest files connect as in CI — omitting it
-- makes those tests fail with "permission denied for function".
REVOKE ALL ON FUNCTION family_calendar.peek_invite(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION family_calendar.peek_invite(TEXT) TO app_user';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user_test') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION family_calendar.peek_invite(TEXT) TO app_user_test';
  END IF;
END $$;
