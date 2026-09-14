-- migrate-v17 — a database backstop for writes to `families` (HOLZMAN-182).
--
-- ── WHY ──
-- `families` is one of the three non-RLS tenancy tables (families/users/memberships),
-- and correctly so: it IS the tenant list, and it must be readable before any tenant
-- context exists — the feed-token lookup and the invite landing page both read it
-- pre-auth. A row-level security policy would break those reads.
--
-- The consequence was that the only thing stopping one family writing another's row
-- was application discipline. A red-team lane demonstrated it: raw SQL as the app
-- role, sitting in family A's tenant context, overwrote family B's branch list. The
-- app's single write path (setFamilyBranches) was never exploitable — it picks its row
-- from the tenant GUC and takes no caller-supplied id — but one careless future write
-- would have made it real, with nothing underneath to catch it. The most likely
-- mistake is exactly the easy one: `systemQuery('UPDATE families … WHERE id = $1',
-- [idFromTheForm])`, because the table has no RLS to remind anyone.
--
-- ── THE RULE ──
-- A BEFORE UPDATE OR DELETE trigger. For every role that is not the table's owner —
-- which is every role the app is allowed to connect as (see STATE.md, standing rules)
-- — a `families` row can be changed or deleted ONLY from inside that same family's
-- tenant context:
--
--     app.current_family is set  AND  it names this row  AND  the id is not changing
--
-- Everything else raises SQLSTATE 42501 (insufficient_privilege), before any
-- constraint check and before ON DELETE CASCADE can touch the family's data. Because
-- the trigger is FOR EACH ROW, a statement that reaches past its own family (an
-- UPDATE with a missing WHERE) fails as a whole — its own row rolls back with it.
--
-- Deliberately NOT restricted:
--   • SELECT — the pre-auth reads above. A trigger cannot fire on a read, which is why
--     this is a trigger and not a policy.
--   • INSERT — onboarding creates a family before any tenant exists
--     (createFamilyWithOwner runs in a system transaction), and an insert cannot
--     overwrite another family: the id comes from the sequence and is the primary key.
--   • TRUNCATE — the app role is never granted it (SELECT/INSERT/UPDATE/DELETE only),
--     and row triggers do not fire on it.
--   • The table OWNER (and superusers) — migrations and maintenance legitimately
--     rewrite every family at once (migrate-v13 backfilled feed_token for all of them),
--     and the owner could drop this trigger anyway. The backstop is aimed at the role
--     the application connects as; that role must never be the owner.
--
-- What it is NOT: a defence against someone who already holds the app role's
-- credentials and a SQL prompt. They can set app.current_family themselves — the same
-- property RLS has in this schema. It exists to make the next person's MISTAKE fail
-- loudly, the moment it runs, instead of silently writing across tenants.
--
-- No GRANTs: the function is SECURITY INVOKER (it runs as whoever issued the write,
-- which is the point), and trigger functions need no EXECUTE grant to fire.
--
-- Idempotent: CREATE OR REPLACE for the function, DROP IF EXISTS + CREATE for the
-- trigger (CREATE OR REPLACE TRIGGER needs PostgreSQL 14; the README promises 13+).

CREATE OR REPLACE FUNCTION family_calendar.families_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  tenant integer := nullif(current_setting('app.current_family', true), '')::integer;
  verb   text    := CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END;
BEGIN
  -- The owner (migrations, maintenance) is trusted with cross-family writes.
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'MEMBER') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF tenant IS NULL OR OLD.id <> tenant THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('family %s can only be %s from inside that family', OLD.id, verb),
      DETAIL  = CASE WHEN tenant IS NULL
                  THEN 'No tenant context is set (app.current_family is empty).'
                  ELSE format('The current tenant context is family %s.', tenant)
                END,
      HINT    = 'Write families through the tenant-scoped query(), and select the row with '
                'WHERE id = nullif(current_setting(''app.current_family'', true), '''')::int '
                '(see setFamilyBranches in src/lib/branches-server.ts).';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('family %s cannot be given a different id', OLD.id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS families_write_guard ON family_calendar.families;
CREATE TRIGGER families_write_guard
  BEFORE UPDATE OR DELETE ON family_calendar.families
  FOR EACH ROW EXECUTE FUNCTION family_calendar.families_write_guard();
