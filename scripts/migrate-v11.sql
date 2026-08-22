-- V11: family-scoped INVITE tokens (Task 3.2).
--
-- Adds a third access_tokens.kind — 'invite' — used for family invite links an
-- owner mints to bring relatives in. An invite carries the role the joiner will
-- receive (editor|viewer) in the new invite_role column. Redemption creates a
-- membership for the signed-in Google user in the invite's family (family_id is
-- already on the row from migrate-v10 + the GUC default).
--
-- Safe to run multiple times (guards + drop-then-recreate constraints).

-- 1. invite_role column: the membership role a redeemer gets. NULL for the
--    legacy 'shared'/'personal' kinds; required (via CHECK below) for 'invite'.
ALTER TABLE family_calendar.access_tokens
  ADD COLUMN IF NOT EXISTS invite_role TEXT;

-- 2. Extend the kind whitelist to allow 'invite'.
ALTER TABLE family_calendar.access_tokens
  DROP CONSTRAINT IF EXISTS access_tokens_kind_check;
ALTER TABLE family_calendar.access_tokens
  ADD CONSTRAINT access_tokens_kind_check
  CHECK (kind IN ('shared', 'personal', 'invite'));

-- 3. Extend the person_id shape rule so 'invite' rows are valid.
--    shared  → no person; personal → a person; invite → no person.
ALTER TABLE family_calendar.access_tokens
  DROP CONSTRAINT IF EXISTS access_tokens_check;
ALTER TABLE family_calendar.access_tokens
  ADD CONSTRAINT access_tokens_check
  CHECK (
    (kind = 'shared'   AND person_id IS NULL) OR
    (kind = 'personal' AND person_id IS NOT NULL) OR
    (kind = 'invite'   AND person_id IS NULL)
  );

-- 4. invite_role must be a valid role, and is REQUIRED for 'invite' rows,
--    NULL otherwise. Keeps the column meaningful and tamper-evident.
ALTER TABLE family_calendar.access_tokens
  DROP CONSTRAINT IF EXISTS access_tokens_invite_role_check;
ALTER TABLE family_calendar.access_tokens
  ADD CONSTRAINT access_tokens_invite_role_check
  CHECK (
    (kind = 'invite'  AND invite_role IN ('editor', 'viewer')) OR
    (kind <> 'invite' AND invite_role IS NULL)
  );

-- 5. redeem_invite(): the ONE legitimate cross-tenant operation in the app.
--
-- A joiner opening an invite link has NO active family yet, so there is no tenant
-- GUC to scope access_tokens by — and the app's DB role is NOT a BYPASSRLS role,
-- so a plain SELECT on the RLS-scoped access_tokens table returns nothing. Rather
-- than hand the app ambient RLS-bypass, we encapsulate exactly this one action in
-- a SECURITY DEFINER function owned by the table owner (which is BYPASSRLS). It:
--   • looks up a live, non-revoked, non-expired 'invite' token by its secret hash,
--   • creates the membership (ON CONFLICT DO NOTHING — re-redeem is a no-op that
--     never downgrades an existing role),
--   • stamps last_used_at,
-- and returns the joined family_id + granted role. On a bad/expired/wrong-kind
-- token it returns no row. Narrow, auditable, and the only cross-tenant door.
-- DROP first: changing the RETURNS TABLE column names isn't allowed by
-- CREATE OR REPLACE. Signature (arg types) is stable, so this stays idempotent.
DROP FUNCTION IF EXISTS family_calendar.redeem_invite(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION family_calendar.redeem_invite(p_token_hash TEXT, p_user_id INTEGER)
RETURNS TABLE (out_family_id INTEGER, out_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = family_calendar, pg_temp
AS $fn$
DECLARE
  v_family_id  INTEGER;
  v_role       TEXT;
BEGIN
  SELECT t.family_id, t.invite_role
    INTO v_family_id, v_role
    FROM family_calendar.access_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.kind = 'invite'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > NOW())
   LIMIT 1;

  IF v_family_id IS NULL THEN
    RETURN;  -- no valid invite → caller renders a friendly error
  END IF;

  INSERT INTO family_calendar.memberships (user_id, family_id, role)
  VALUES (p_user_id, v_family_id, v_role)
  ON CONFLICT (user_id, family_id) DO NOTHING;

  UPDATE family_calendar.access_tokens
     SET last_used_at = NOW()
   WHERE token_hash = p_token_hash;

  out_family_id := v_family_id;
  out_role      := v_role;
  RETURN NEXT;
END;
$fn$;

-- Only the app roles need to call it; revoke the public default then grant.
REVOKE ALL ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) TO app_user';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user_test') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) TO app_user_test';
  END IF;
END $$;
