import { query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';

/**
 * Delete test families, each from inside ITS OWN tenant context.
 *
 * Since migrate-v17 the database refuses to change or delete a `families` row from
 * anywhere but that family's own context — the app role is not trusted with a
 * cross-family write — so the old `systemQuery('DELETE FROM families …')` cleanup fails
 * with SQLSTATE 42501. The family's rows in every tenant table go with it through
 * ON DELETE CASCADE, exactly as before.
 *
 * Skips null/undefined and 0 (the "never created" placeholder the test files use), so
 * it is safe to call from a `finally` whether or not setup got that far.
 */
export async function deleteFamilies(...ids: Array<number | null | undefined>): Promise<void> {
  for (const id of ids) {
    if (id == null || id === 0) continue;
    await runWithTenant(id, () =>
      query('DELETE FROM family_calendar.families WHERE id = $1', [id])
    );
  }
}
