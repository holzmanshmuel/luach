import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { setFamilyBranches } from '@/lib/branches-server';
import { deleteFamilies } from '@/test-stubs/families';

/**
 * HOLZMAN-182 — the database backstop on `families` writes (migrate-v17).
 *
 * `families` has no RLS: it IS the tenant list, and has to be readable before any
 * tenant context exists. So until migrate-v17 the only thing stopping one family
 * writing another's row was application discipline — and a red-team lane proved it,
 * overwriting family B's branch list with raw SQL from inside family A's context.
 *
 * The trigger turns that into a database error: for any role but the table owner, a
 * `families` row can be changed or deleted only from inside that same family's tenant
 * context. These run as the restricted app role. The first test fails loudly if they
 * are not, because as the owner every refusal below would silently stop happening and
 * the "still allowed" tests would prove nothing.
 *
 * Requires DATABASE_URL pointing at a migrated test database as the app role.
 * All names are fictional.
 */

const INSUFFICIENT_PRIVILEGE = '42501';

let familyA = 0;
let familyB = 0;

const inA = <T>(fn: () => Promise<T>) => runWithTenant(familyA, fn);

async function familyRow(id: number) {
  const [row] = await systemQuery<{ name: string; branches: string[] | null }>(
    'SELECT name, branches FROM family_calendar.families WHERE id = $1',
    [id]
  );
  return row;
}

beforeAll(async () => {
  [{ id: familyA }] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name, branches) VALUES ('Write Guard A', '{}') RETURNING id"
  );
  [{ id: familyB }] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name, branches) VALUES ('Write Guard B', ARRAY['Levi', 'Other']) RETURNING id"
  );
});

afterAll(async () => {
  await deleteFamilies(familyA, familyB);
});

describe('families write guard (migrate-v17)', () => {
  it('is installed, and this suite is NOT connected as the table owner', async () => {
    const [state] = await systemQuery<{ installed: boolean; owner: boolean }>(
      `SELECT EXISTS (
                SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'family_calendar.families'::regclass
                   AND tgname = 'families_write_guard'
                   AND tgenabled <> 'D'
              ) AS installed,
              pg_has_role(
                current_user,
                (SELECT relowner FROM pg_class WHERE oid = 'family_calendar.families'::regclass),
                'MEMBER'
              ) AS owner`
    );
    expect(state).toEqual({ installed: true, owner: false });
  });

  describe('refuses', () => {
    it("the red-team write: family A's context overwriting family B's branch list", async () => {
      await expect(
        inA(() =>
          query("UPDATE family_calendar.families SET branches = ARRAY['Cohen', 'Other'] WHERE id = $1", [familyB])
        )
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect((await familyRow(familyB)).branches).toEqual(['Levi', 'Other']);
    });

    it('an update with no tenant context at all — the careless systemQuery shape', async () => {
      await expect(
        systemQuery("UPDATE family_calendar.families SET name = 'Renamed' WHERE id = $1", [familyA])
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect((await familyRow(familyA)).name).toBe('Write Guard A');
    });

    it('a statement that reaches past its own family — and its own row rolls back with it', async () => {
      await expect(
        inA(() => query("UPDATE family_calendar.families SET name = name || ' (edited)'"))
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect((await familyRow(familyA)).name).toBe('Write Guard A');
      expect((await familyRow(familyB)).name).toBe('Write Guard B');
    });

    it("giving a family's own row a different id", async () => {
      await expect(
        inA(() =>
          query('UPDATE family_calendar.families SET id = $1 WHERE id = $2', [familyA + 1_000_000, familyA])
        )
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect(await familyRow(familyA)).toBeDefined();
    });

    it("deleting another family from inside one's own — before the cascade can take their data", async () => {
      const [{ id: person }] = await runWithTenant(familyB, () =>
        query<{ id: number }>(
          "INSERT INTO family_calendar.family_members (name, last_name) VALUES ('Yosef', 'Levi') RETURNING id"
        )
      );

      await expect(
        inA(() => query('DELETE FROM family_calendar.families WHERE id = $1', [familyB]))
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect(await familyRow(familyB)).toBeDefined();
      const stillThere = await runWithTenant(familyB, () =>
        query('SELECT id FROM family_calendar.family_members WHERE id = $1', [person])
      );
      expect(stillThere).toHaveLength(1);
    });

    it('a delete with no tenant context at all', async () => {
      await expect(
        systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyA])
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

      expect(await familyRow(familyA)).toBeDefined();
    });
  });

  describe('still allows', () => {
    it("a family changing its own row from its own context — setFamilyBranches, the app's real write path", async () => {
      await expect(inA(() => setFamilyBranches(['Mizrahi', 'Other']))).resolves.toEqual(['Mizrahi', 'Other']);
      expect((await familyRow(familyA)).branches).toEqual(['Mizrahi', 'Other']);
    });

    it('the pre-auth paths: creating a family and finding one by feed token, with no tenant context', async () => {
      const [created] = await systemQuery<{ id: number; feed_token: string }>(
        "INSERT INTO family_calendar.families (name) VALUES ('Write Guard New') RETURNING id, feed_token"
      );
      try {
        const found = await systemQuery<{ id: number }>(
          'SELECT id FROM family_calendar.families WHERE feed_token = $1',
          [created.feed_token]
        );
        expect(found.map(f => f.id)).toEqual([created.id]);
      } finally {
        await deleteFamilies(created.id);
      }
    });

    it('a family deleting its own row from its own context', async () => {
      const [{ id }] = await systemQuery<{ id: number }>(
        "INSERT INTO family_calendar.families (name) VALUES ('Write Guard Leaving') RETURNING id"
      );
      await deleteFamilies(id);
      expect(await familyRow(id)).toBeUndefined();
    });
  });
});
