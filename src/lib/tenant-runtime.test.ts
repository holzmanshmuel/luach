import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT.
 *
 * `tenant-propagation.test.ts` injects a stand-in for React's `cache()` and so can
 * only ever assert the design contract — it passed happily while every add, edit and
 * delete in the production app returned
 *   "No tenant context: query() called without an active family."
 *
 * This file exercises the REAL path instead: the real guards, the real `cache()`
 * (a pass-through here, exactly as it is inside a Server Action — it memoizes only
 * during an RSC RENDER, and there is no render in scope), a real iron-session
 * cookie, and a real tenant-scoped `query()` against a real Postgres.
 *
 * It asserts BOTH directions, because only the contrast is proof:
 *   • through `withEditor()` the row is written;
 *   • the OLD shape — `await requireEditor()` then `query()` — throws.
 *
 * The second half asserts the other thing a tenant boundary has to do here: client-
 * supplied person ids cannot pull another family's member into a relationship row.
 * RLS does not stop that on its own — Postgres checks the FOREIGN KEY with RLS
 * bypassed — so the actions check it, and the last test proves the database really
 * would have allowed it.
 *
 * Requires DATABASE_URL pointing at a test Postgres with the migrations applied,
 * connected as the restricted app role (never the owner — RLS is skipped for
 * superusers). All names below are fictional.
 */

const { cookieJar } = vi.hoisted(() => {
  // The session cookie is sealed for real, so a password must exist. sessionOptions
  // reads it lazily at request time, so setting it here is early enough.
  process.env.SESSION_PASSWORD ||= 'luach-tenant-runtime-test-password-0123456789';
  return { cookieJar: new Map<string, string>() };
});

// The only stand-ins: Next's request-scoped cookie/header stores and revalidatePath,
// none of which is the mechanism under test. cache() is deliberately NOT stubbed.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
    has: (name: string) => cookieJar.has(name),
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getSession, requireEditor, withEditor } from '@/lib/auth';
import { query, systemQuery } from '@/lib/db';
import { getFamilyId, runWithTenant } from '@/lib/tenant';
import { getT } from '@/lib/translations';
import { createPersonAction, updatePersonRelationshipsAction } from '@/app/actions';

const UNKNOWN_PERSON = getT('en')('err.unknown_person');

let familyA = 0;
let familyB = 0;
let userId = 0;
let personInA = 0;
let personInB = 0;

/** Put a sealed session cookie in the jar, as a signed-in owner of `familyId`. */
async function signInAs(familyId: number): Promise<void> {
  cookieJar.clear();
  const session = await getSession();
  session.userId = userId;
  session.familyId = familyId;
  await session.save();
}

beforeAll(async () => {
  const suffix = `${Date.now()}`;
  [{ id: familyA }] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name, branches) VALUES ('Runtime Test A', '{}') RETURNING id"
  );
  [{ id: familyB }] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name, branches) VALUES ('Runtime Test B', '{}') RETURNING id"
  );
  [{ id: userId }] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.users (google_sub, email) VALUES ($1, $2) RETURNING id',
    [`runtime-test-${suffix}`, `runtime-test-${suffix}@example.invalid`]
  );
  // Owner of A only. The user is deliberately NOT a member of B.
  await systemQuery(
    "INSERT INTO family_calendar.memberships (user_id, family_id, role) VALUES ($1, $2, 'owner')",
    [userId, familyA]
  );

  [{ id: personInA }] = await runWithTenant(familyA, () =>
    query<{ id: number }>(
      "INSERT INTO family_calendar.family_members (name, last_name) VALUES ('Yaakov', 'Rosenfeld') RETURNING id"
    )
  );
  [{ id: personInB }] = await runWithTenant(familyB, () =>
    query<{ id: number }>(
      "INSERT INTO family_calendar.family_members (name, last_name) VALUES ('Devorah', 'Steinmetz') RETURNING id"
    )
  );
});

afterAll(async () => {
  // families cascade to members, relationships and memberships.
  await systemQuery('DELETE FROM family_calendar.families WHERE id = ANY($1)', [
    [familyA, familyB],
  ]);
  await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
  cookieJar.clear();
});

describe('tenant context inside a Server Action (real guards, real Postgres, no render)', () => {
  it('the OLD shape — bare requireEditor() then query() — throws "No tenant context"', async () => {
    await signInAs(familyA);

    // No render and no runWithTenant: this is exactly the context a Server Action
    // body runs in. If this is not null the rest of the test proves nothing.
    expect(getFamilyId()).toBeNull();

    await expect(
      (async () => {
        const denied = await requireEditor();
        // The guard itself PASSES — that is the trap. It verified the membership
        // and called enterTenant(); neither survived the await back to here.
        expect(denied).toBeNull();
        await query(
          "INSERT INTO family_calendar.family_members (name) VALUES ('Never Written')"
        );
      })()
    ).rejects.toThrow('No tenant context');

    const orphans = await runWithTenant(familyA, () =>
      query("SELECT id FROM family_calendar.family_members WHERE name = 'Never Written'")
    );
    expect(orphans).toEqual([]);
  });

  it('withEditor() runs the same body with tenant context, and the row is written', async () => {
    await signInAs(familyA);
    expect(getFamilyId()).toBeNull();

    const result = await withEditor(async () => {
      const rows = await query<{ id: number }>(
        "INSERT INTO family_calendar.family_members (name, last_name) VALUES ('Tzipporah', 'Wolfson') RETURNING id"
      );
      return { id: rows[0].id };
    });

    expect(result).not.toHaveProperty('error');
    const { id } = result as { id: number };

    const [row] = await runWithTenant(familyA, () =>
      query<{ name: string; family_id: number }>(
        'SELECT name, family_id FROM family_calendar.family_members WHERE id = $1',
        [id]
      )
    );
    expect(row.name).toBe('Tzipporah');
    expect(row.family_id).toBe(familyA);
  });

  it('a whole Server Action — createPersonAction — persists the person it says it created', async () => {
    await signInAs(familyA);

    const result = await createPersonAction({
      name: 'Nachum',
      last_name: 'Feldbrand',
      family_branch: '',
      parent_ids: [personInA],
    });

    expect(result.error).toBeUndefined();
    expect(result.id).toBeTypeOf('number');

    const [saved] = await runWithTenant(familyA, () =>
      query<{ name: string; family_id: number }>(
        'SELECT name, family_id FROM family_calendar.family_members WHERE id = $1',
        [result.id!]
      )
    );
    expect(saved.name).toBe('Nachum');
    expect(saved.family_id).toBe(familyA);

    // The relationship rows in its withTransaction() landed too — the transaction
    // reads the tenant when it opens, so it had to run INSIDE the tenant callback.
    const edges = await runWithTenant(familyA, () =>
      query<{ person_id: number }>(
        "SELECT person_id FROM family_calendar.relationships WHERE related_to = $1 AND relation = 'parent'",
        [result.id!]
      )
    );
    expect(edges.map(e => e.person_id)).toEqual([personInA]);
  });

  it('view-only and signed-out callers still get the exact same refusals', async () => {
    // Signed out: no cookie at all.
    cookieJar.clear();
    expect(await withEditor(async () => ({ ok: true }))).toEqual({
      error: 'Please sign in.',
    });

    // Signed in, but with no membership in the family the cookie names.
    cookieJar.clear();
    const session = await getSession();
    session.userId = userId;
    session.familyId = familyB;
    await session.save();
    expect(await withEditor(async () => ({ ok: true }))).toEqual({
      error: 'You are not a member of this family.',
    });

    // A live membership that may not edit.
    await systemQuery(
      "UPDATE family_calendar.memberships SET role = 'viewer' WHERE user_id = $1 AND family_id = $2",
      [userId, familyA]
    );
    await signInAs(familyA);
    expect(await withEditor(async () => ({ ok: true }))).toEqual({
      error: 'You have view-only access.',
    });
    await systemQuery(
      "UPDATE family_calendar.memberships SET role = 'owner' WHERE user_id = $1 AND family_id = $2",
      [userId, familyA]
    );
  });
});

describe('cross-tenant ids cannot enter a relationship row', () => {
  it('createPersonAction rejects a parent id from another family and writes nothing', async () => {
    await signInAs(familyA);

    const result = await createPersonAction({
      name: 'Malka',
      last_name: 'Ehrenreich',
      family_branch: '',
      parent_ids: [personInB],
    });

    expect(result.error).toBe(UNKNOWN_PERSON);
    expect(result.id).toBeUndefined();

    const created = await runWithTenant(familyA, () =>
      query("SELECT id FROM family_calendar.family_members WHERE name = 'Malka'")
    );
    expect(created).toEqual([]);

    const edges = await runWithTenant(familyA, () =>
      query('SELECT id FROM family_calendar.relationships WHERE person_id = $1 OR related_to = $1', [
        personInB,
      ])
    );
    expect(edges).toEqual([]);
  });

  it('createPersonAction rejects a spouse id from another family and writes nothing', async () => {
    await signInAs(familyA);

    const result = await createPersonAction({
      name: 'Shprintza',
      family_branch: '',
      parent_ids: [],
      spouse_id: personInB,
    });

    expect(result.error).toBe(UNKNOWN_PERSON);
    const created = await runWithTenant(familyA, () =>
      query("SELECT id FROM family_calendar.family_members WHERE name = 'Shprintza'")
    );
    expect(created).toEqual([]);
  });

  it('updatePersonRelationshipsAction rejects another family\'s id, as parent or spouse', async () => {
    await signInAs(familyA);

    expect(
      await updatePersonRelationshipsAction({
        personId: personInA,
        parentIds: [personInB],
        spouseIds: [],
      })
    ).toEqual({ error: UNKNOWN_PERSON });

    expect(
      await updatePersonRelationshipsAction({
        personId: personInA,
        parentIds: [],
        spouseIds: [personInB],
      })
    ).toEqual({ error: UNKNOWN_PERSON });

    // And the person being edited must be ours too.
    expect(
      await updatePersonRelationshipsAction({
        personId: personInB,
        parentIds: [],
        spouseIds: [],
      })
    ).toEqual({ error: UNKNOWN_PERSON });

    const edges = await runWithTenant(familyA, () =>
      query('SELECT id FROM family_calendar.relationships WHERE person_id = $1 OR related_to = $1', [
        personInB,
      ])
    );
    expect(edges).toEqual([]);
  });

  it('the DATABASE would have allowed it — the check in the action is what stops it', async () => {
    // Without this, the tests above could pass for the wrong reason. RLS scopes the
    // new row's own family_id, but Postgres checks the FOREIGN KEY to family_members
    // with RLS BYPASSED, so family A really can point a row at family B's member.
    const [row] = await runWithTenant(familyA, () =>
      query<{ id: number; family_id: number }>(
        `INSERT INTO family_calendar.relationships (person_id, related_to, relation)
         VALUES ($1, $2, 'parent') RETURNING id, family_id`,
        [personInB, personInA]
      )
    );
    expect(row.family_id).toBe(familyA); // stamped as A's row…

    // …while selecting that person id as family A returns nothing at all.
    const visible = await runWithTenant(familyA, () =>
      query('SELECT id FROM family_calendar.family_members WHERE id = $1', [personInB])
    );
    expect(visible).toEqual([]);

    await runWithTenant(familyA, () =>
      query('DELETE FROM family_calendar.relationships WHERE id = $1', [row.id])
    );
  });
});
