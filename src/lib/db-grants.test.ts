import { describe, it, expect } from 'vitest';
import { systemQuery } from '@/lib/db';

/**
 * The app connects as a restricted, non-superuser role, and every cross-tenant
 * operation is encapsulated in a SECURITY DEFINER function that role must be
 * granted EXECUTE on. Miss a grant and the feature dies with "permission denied"
 * — at runtime, on the one path that needed it.
 *
 * That is not hypothetical. `peek_invite` shipped with its grant in the migration,
 * in the README and in SETUP.md, but not in `.github/workflows/ci.yml` — and the
 * migration's grant is conditional on the role already existing, while CI creates
 * the role AFTER migrating. So the grant silently no-opped and nine tests failed
 * on CI having passed locally, where the role predated the migration.
 *
 * This test closes that loop by construction: it asks the DATABASE what SECURITY
 * DEFINER functions exist rather than listing them, so adding one without granting
 * it fails here instead of in production.
 */
describe('SECURITY DEFINER functions are executable by the app role', () => {
  it('grants EXECUTE on every one of them to the connecting role', async () => {
    const rows = await systemQuery<{ fn: string; executable: boolean }>(
      `SELECT p.oid::regprocedure::text AS fn,
              has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable
         FROM pg_proc p
        WHERE p.pronamespace = 'family_calendar'::regnamespace
          AND p.prosecdef
        ORDER BY fn`
    );

    // If this is empty the query is wrong, not the schema — there is at least one.
    expect(rows.length).toBeGreaterThan(0);

    const ungranted = rows.filter(r => !r.executable).map(r => r.fn);
    expect(
      ungranted,
      `No EXECUTE grant for: ${ungranted.join(', ')}. Add it to the migration, ` +
        'to .github/workflows/ci.yml, to README.md and to SETUP.md — CI creates the ' +
        'role after migrating, so the migration\'s conditional grant will not fire there.'
    ).toEqual([]);
  });
});
