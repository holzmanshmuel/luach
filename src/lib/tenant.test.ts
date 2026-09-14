import { describe, it, expect } from 'vitest';
import { runWithTenant } from '@/lib/tenant';
import { query, systemQuery } from '@/lib/db';
import { deleteFamilies } from '@/test-stubs/families';

// Requires DATABASE_URL pointing at a test/dev Postgres with migrations v9+v10 applied.
describe('tenant isolation', () => {
  it('a family only ever sees its own members', async () => {
    const [a] = await systemQuery<{ id: number }>(
      "INSERT INTO family_calendar.families (name) VALUES ('Test A') RETURNING id");
    const [b] = await systemQuery<{ id: number }>(
      "INSERT INTO family_calendar.families (name) VALUES ('Test B') RETURNING id");

    await runWithTenant(a.id, () =>
      query("INSERT INTO family_calendar.family_members (name) VALUES ('Alice')"));
    await runWithTenant(b.id, () =>
      query("INSERT INTO family_calendar.family_members (name) VALUES ('Bob')"));

    const aNames = await runWithTenant(a.id, () =>
      query<{ name: string }>('SELECT name FROM family_calendar.family_members'));
    const bNames = await runWithTenant(b.id, () =>
      query<{ name: string }>('SELECT name FROM family_calendar.family_members'));

    expect(aNames.map(r => r.name)).toEqual(['Alice']);
    expect(bNames.map(r => r.name)).toEqual(['Bob']);

    // cleanup
    await deleteFamilies(a.id, b.id);
  });
});
