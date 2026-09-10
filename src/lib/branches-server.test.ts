import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import {
  familyBranches,
  storedFamilyBranches,
  setFamilyBranches,
  validateBranchList,
} from '@/lib/branches-server';
import {
  DEFAULT_FAMILY_BRANCHES,
  MAX_BRANCHES,
  MAX_BRANCH_NAME_LENGTH,
} from '@/lib/branches';

/**
 * Requires DATABASE_URL pointing at staging Postgres with migration v14 applied
 * (families.branches — nullable TEXT[], no backfill, shape CHECK). Run as
 * app_user, the role the app really connects as, so the table-level grants that
 * must cover the new column are the ones exercised here.
 *
 * WHAT THIS FILE IS FOR
 * `FAMILY_BRANCHES` used to be a single deployment-wide setting in a multi-tenant
 * app, so the second unrelated family to sign up saw the FIRST family's surnames.
 * These tests pin the fix from both ends: the resolution chain (own list → env →
 * built-in default) and the isolation — one family's list is not readable as
 * another's, and the write cannot be aimed at a family the request is not in.
 *
 * `families` is one of the non-RLS tenancy tables, so the fixtures are systemQuery
 * (same discipline as feed-token.test.ts / users.ts). The WRITE deliberately is
 * not: setFamilyBranches() goes through the tenant-scoped query(), which is what
 * makes the tenant GUC — not an argument — choose the row.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

async function makeFamily(name: string, branches?: string[]): Promise<number> {
  const [row] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.families (name, branches) VALUES ($1, $2) RETURNING id',
    [name, branches ?? null]
  );
  return row.id;
}

async function dropFamily(id: number): Promise<void> {
  await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [id]);
}

async function readColumn(id: number): Promise<string[] | null> {
  const [row] = await systemQuery<{ branches: string[] | null }>(
    'SELECT branches FROM family_calendar.families WHERE id = $1',
    [id]
  );
  return row.branches;
}

// ---------------------------------------------------------------------------
// The column itself
// ---------------------------------------------------------------------------
describe('families.branches column (migrate-v14)', () => {
  it('is NULL for a new family — nothing is backfilled, and there is no DEFAULT', async () => {
    // This is the whole point of leaving it NULL: the existing production family
    // and every single-family self-hoster keep working on their env var with zero
    // data migration. A DEFAULT would freeze today's env value into every row.
    const id = await makeFamily('Branches Null Default');
    try {
      expect(await readColumn(id)).toBeNull();
    } finally {
      await dropFamily(id);
    }

    const [col] = await systemQuery<{ column_default: string | null; is_nullable: string }>(
      `SELECT column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'family_calendar'
          AND table_name = 'families'
          AND column_name = 'branches'`
    );
    expect(col).toBeDefined();
    expect(col.column_default).toBeNull();
    expect(col.is_nullable).toBe('YES');
  });

  it('round-trips an ORDERED list — order is colour, so it must not be a set', async () => {
    const ordered = ['Zeta', 'Alpha', 'Mu', 'Rest'];
    const id = await makeFamily('Branches Order', ordered);
    try {
      expect(await readColumn(id)).toEqual(ordered);
    } finally {
      await dropFamily(id);
    }
  });

  it('accepts non-Latin names (the column is TEXT[], not an enum)', async () => {
    const id = await makeFamily('Branches Hebrew', ['לוי', 'כהן', 'אחר']);
    try {
      expect(await readColumn(id)).toEqual(['לוי', 'כהן', 'אחר']);
    } finally {
      await dropFamily(id);
    }
  });

  it('rejects a NULL element, an empty-string element, and an absurd count', async () => {
    // The app never writes these; the CHECK is for psql and future scripts.
    await expect(makeFamily('Branches Bad Null', ['A', null as unknown as string, 'Rest']))
      .rejects.toThrow();
    await expect(makeFamily('Branches Bad Empty', ['A', '', 'Rest'])).rejects.toThrow();
    await expect(
      makeFamily('Branches Bad Count', [...Array(MAX_BRANCHES + 1).keys()].map(i => `B${i}`))
    ).rejects.toThrow();
    await expect(makeFamily('Branches Bad Length', ['A'.repeat(2000), 'Rest'])).rejects.toThrow();
  });

  it('keeps the CHECK constraint in step with the app-side limits', () => {
    // The SQL cannot import the TypeScript constants, so this is the gate that
    // makes editing one and forgetting the other fail loudly instead of letting
    // the two guards drift.
    const sql = fs.readFileSync(
      new URL('../../scripts/migrate-v14.sql', import.meta.url),
      'utf-8'
    );
    expect(sql).toContain(`cardinality(branches) BETWEEN 1 AND ${MAX_BRANCHES}`);
    expect(sql).toContain(
      `length(array_to_string(branches, ',')) <= ${MAX_BRANCHES * MAX_BRANCH_NAME_LENGTH + (MAX_BRANCHES - 1)}`
    );
  });
});

// ---------------------------------------------------------------------------
// Resolution: own list → FAMILY_BRANCHES → DEFAULT_FAMILY_BRANCHES
// ---------------------------------------------------------------------------
describe('familyBranches() — the resolution chain, end to end', () => {
  const ENV = 'EnvOne,EnvTwo,EnvRest';

  it("1st: a family's OWN stored list wins over the env var", async () => {
    vi.stubEnv('FAMILY_BRANCHES', ENV);
    const own = ['MyOne', 'MyTwo', 'MyRest'];
    const id = await makeFamily('Branches Chain Own', own);
    try {
      expect(await familyBranches(id)).toEqual(own);
      expect(await runWithTenant(id, () => familyBranches())).toEqual(own);
    } finally {
      await dropFamily(id);
    }
  });

  it('2nd: a family with no list of its own falls back to FAMILY_BRANCHES', async () => {
    vi.stubEnv('FAMILY_BRANCHES', ENV);
    const id = await makeFamily('Branches Chain Env');
    try {
      expect(await familyBranches(id)).toEqual(['EnvOne', 'EnvTwo', 'EnvRest']);
    } finally {
      await dropFamily(id);
    }
  });

  it('3rd: no stored list and no env var falls back to the built-in default', async () => {
    vi.stubEnv('FAMILY_BRANCHES', undefined);
    const id = await makeFamily('Branches Chain Default');
    try {
      expect(await familyBranches(id)).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    } finally {
      await dropFamily(id);
    }
  });

  it('resolves the deployment default when there is no tenant at all (signed-out render)', async () => {
    vi.stubEnv('FAMILY_BRANCHES', ENV);
    // The root layout resolves the list for signed-out visitors too; with no
    // family entered there is nothing to look up, and this must not throw.
    expect(await familyBranches()).toEqual(['EnvOne', 'EnvTwo', 'EnvRest']);
    expect(await familyBranches(null)).toEqual(['EnvOne', 'EnvTwo', 'EnvRest']);
  });

  it('resolves an unknown family id to the default rather than throwing', async () => {
    vi.stubEnv('FAMILY_BRANCHES', ENV);
    expect(await familyBranches(2147483000)).toEqual(['EnvOne', 'EnvTwo', 'EnvRest']);
  });

  it('storedFamilyBranches() reports NULL as "not set", distinct from the resolved list', async () => {
    vi.stubEnv('FAMILY_BRANCHES', ENV);
    const id = await makeFamily('Branches Stored Null');
    try {
      // The /admin/branches page needs this difference to tell an owner whether
      // they are looking at their own list or at an inherited default.
      expect(await storedFamilyBranches(id)).toBeNull();
      expect(await familyBranches(id)).not.toBeNull();
    } finally {
      await dropFamily(id);
    }
  });
});

// ---------------------------------------------------------------------------
// The bug: one deployment, several unrelated families
// ---------------------------------------------------------------------------
describe('cross-family isolation of families.branches', () => {
  it('gives two families on ONE deployment two different lists', async () => {
    // The defect this replaces: both of these would have shown the same chips.
    vi.stubEnv('FAMILY_BRANCHES', 'EnvOne,EnvTwo,EnvRest');
    const a = await makeFamily('Branches Tenant A', ['Ay', 'Aye', 'ARest']);
    const b = await makeFamily('Branches Tenant B', ['Bee', 'BRest']);
    try {
      expect(await familyBranches(a)).toEqual(['Ay', 'Aye', 'ARest']);
      expect(await familyBranches(b)).toEqual(['Bee', 'BRest']);
      // Under A's tenant context, A's list is what resolves — not B's, not the env.
      expect(await runWithTenant(a, () => familyBranches())).toEqual(['Ay', 'Aye', 'ARest']);
      expect(await runWithTenant(b, () => familyBranches())).toEqual(['Bee', 'BRest']);
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('lets one family set its own list without touching another that has none', async () => {
    const a = await makeFamily('Branches Write A');
    const b = await makeFamily('Branches Write B');
    try {
      await runWithTenant(a, () => setFamilyBranches(['Ay', 'Aye', 'ARest']));
      expect(await readColumn(a)).toEqual(['Ay', 'Aye', 'ARest']);
      // B never chose a list, so B must still be inheriting — the write did not
      // leak across, and did not "helpfully" backfill anybody.
      expect(await readColumn(b)).toBeNull();
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it("cannot overwrite another family's list, even one that already exists", async () => {
    const a = await makeFamily('Branches Overwrite A', ['Ay', 'ARest']);
    const b = await makeFamily('Branches Overwrite B', ['Bee', 'BRest']);
    try {
      await runWithTenant(a, () => setFamilyBranches(['AyNew', 'AyeNew', 'ARest']));
      expect(await readColumn(a)).toEqual(['AyNew', 'AyeNew', 'ARest']);
      expect(await readColumn(b)).toEqual(['Bee', 'BRest']);

      // …and the other direction, so this is not an accident of ordering.
      await runWithTenant(b, () => setFamilyBranches(['BeeNew', 'BRest']));
      expect(await readColumn(b)).toEqual(['BeeNew', 'BRest']);
      expect(await readColumn(a)).toEqual(['AyNew', 'AyeNew', 'ARest']);
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('refuses to write at all with no tenant context — fails closed, never guesses', async () => {
    // There is no argument through which a caller could name a family, so an
    // unscoped call has nowhere to go and must throw rather than pick a row.
    await expect(setFamilyBranches(['Nope', 'NopeRest'])).rejects.toThrow(/tenant/i);
  });

  it('a write is visible on the next read for that family only', async () => {
    vi.stubEnv('FAMILY_BRANCHES', 'EnvOne,EnvRest');
    const a = await makeFamily('Branches Readback A');
    const b = await makeFamily('Branches Readback B');
    try {
      expect(await familyBranches(a)).toEqual(['EnvOne', 'EnvRest']);
      await runWithTenant(a, () => setFamilyBranches(['Chosen', 'ChosenRest']));
      expect(await familyBranches(a)).toEqual(['Chosen', 'ChosenRest']);
      // B is untouched and still inheriting the deployment value.
      expect(await familyBranches(b)).toEqual(['EnvOne', 'EnvRest']);
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('cleans what it stores, so a resolved read never has to repair it', async () => {
    const a = await makeFamily('Branches Sanitize A');
    try {
      const saved = await runWithTenant(a, () =>
        setFamilyBranches([' Spaced ', 'Two   Words', 'Rest'])
      );
      expect(saved).toEqual(['Spaced', 'Two Words', 'Rest']);
      expect(await readColumn(a)).toEqual(['Spaced', 'Two Words', 'Rest']);
    } finally {
      await dropFamily(a);
    }
  });

  it('rejects an invalid list before it reaches the database', async () => {
    const a = await makeFamily('Branches Invalid A', ['Keep', 'KeepRest']);
    try {
      await expect(runWithTenant(a, () => setFamilyBranches(['Only']))).rejects.toThrow();
      await expect(runWithTenant(a, () => setFamilyBranches(['A', '  ', 'Rest']))).rejects.toThrow();
      // The stored list is untouched by a rejected write.
      expect(await readColumn(a)).toEqual(['Keep', 'KeepRest']);
    } finally {
      await dropFamily(a);
    }
  });
});

// ---------------------------------------------------------------------------
// The guards an owner will actually hit
// ---------------------------------------------------------------------------
describe('validateBranchList', () => {
  const ok = (list: string[]) => {
    const r = validateBranchList(list);
    if ('error' in r) throw new Error(`expected valid, got: ${r.error}`);
    return r.branches;
  };
  const err = (list: string[]): string => {
    const r = validateBranchList(list);
    if (!('error' in r)) throw new Error('expected an error');
    return r.error;
  };

  it('accepts a normal list and trims it', () => {
    expect(ok([' Levy ', 'Katz', 'Other'])).toEqual(['Levy', 'Katz', 'Other']);
  });

  it('rejects a blank name rather than silently dropping it', () => {
    // Dropping it would shift every later entry's position — and position is colour.
    expect(err(['A', '   ', 'Rest'])).toMatch(/needs a name/i);
    expect(err(['A', '', 'Rest'])).toMatch(/needs a name/i);
  });

  it('rejects duplicates, including ones that differ only in case or spacing', () => {
    expect(err(['Katz', 'Katz', 'Rest'])).toMatch(/twice/i);
    expect(err(['Katz', 'katz', 'Rest'])).toMatch(/twice/i);
    expect(err(['Katz', 'Katz  ', 'Rest'])).toMatch(/twice/i);
  });

  it('rejects an absurdly long name', () => {
    expect(err(['A'.repeat(MAX_BRANCH_NAME_LENGTH + 1), 'Rest']))
      .toMatch(new RegExp(`${MAX_BRANCH_NAME_LENGTH}`));
    // …but accepts one exactly at the limit.
    expect(ok(['A'.repeat(MAX_BRANCH_NAME_LENGTH), 'Rest'])).toHaveLength(2);
  });

  it('rejects an absurd number of branches', () => {
    const many = [...Array(MAX_BRANCHES + 1).keys()].map(i => `B${i}`);
    expect(err(many)).toMatch(new RegExp(`${MAX_BRANCHES}`));
    expect(ok([...Array(MAX_BRANCHES).keys()].map(i => `B${i}`))).toHaveLength(MAX_BRANCHES);
  });

  it('insists on at least two entries — one real side plus a catch-all', () => {
    expect(err([])).toMatch(/at least two/i);
    expect(err(['Only'])).toMatch(/at least two/i);
  });
});
