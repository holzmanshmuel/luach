import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

/**
 * HOLZMAN-181 — adding an occasion by TYPING a person's name must find that person.
 *
 * The Add-Event form collects one full name ("Miriam Cohen"), but createEventAction's
 * fallback lookup compared it with the given-name column alone ("Miriam"). So a typed
 * name never matched anyone with a surname, and every such occasion silently created a
 * second person with the same name — the tree then showed two Miriams, neither holding
 * the other's occasions. A new owner entering their side of the family by hand is
 * exactly who hits this, repeatedly, without noticing.
 *
 * These run the real Server Action (real guard, real sealed session cookie, real
 * tenant-scoped query) against a real Postgres, as the restricted app role. Only
 * Next's request-scoped cookie/header stores and revalidatePath are stood in.
 * All names below are fictional.
 */

const { cookieJar } = vi.hoisted(() => {
  process.env.SESSION_PASSWORD ||= 'luach-create-event-person-link-test-password-0123';
  return { cookieJar: new Map<string, string>() };
});

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

import { getSession } from '@/lib/auth';
import { query, systemQuery } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { createEventAction, type EventFormData } from '@/app/actions';

let familyId = 0;
let userId = 0;

const inFamily = <T>(fn: () => Promise<T>) => runWithTenant(familyId, fn);

async function addPerson(name: string, lastName: string | null): Promise<number> {
  const [row] = await inFamily(() =>
    query<{ id: number }>(
      'INSERT INTO family_calendar.family_members (name, last_name) VALUES ($1, $2) RETURNING id',
      [name, lastName]
    )
  );
  return row.id;
}

/** Everyone in the test family, oldest first. */
async function everyone() {
  return inFamily(() =>
    query<{ id: number; name: string; last_name: string | null }>(
      'SELECT id, name, last_name FROM family_calendar.family_members ORDER BY id'
    )
  );
}

async function occasionsOf(memberId: number): Promise<number> {
  const [row] = await inFamily(() =>
    query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM family_calendar.events WHERE family_member_id = $1',
      [memberId]
    )
  );
  return row.n;
}

/** A valid occasion typed for `name` (Hebrew date entered directly, no English date). */
function occasion(name: string, overrides: Partial<EventFormData> = {}): EventFormData {
  return {
    name,
    family_branch: '',
    event_type: 'other',
    event_type_label: 'Siyum',
    hebrew_day: 1,
    hebrew_month: 'Nisan',
    ...overrides,
  };
}

beforeAll(async () => {
  const suffix = `${Date.now()}`;
  [{ id: familyId }] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name, branches) VALUES ('Person Link Test', '{}') RETURNING id"
  );
  [{ id: userId }] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.users (google_sub, email) VALUES ($1, $2) RETURNING id',
    [`person-link-test-${suffix}`, `person-link-test-${suffix}@example.invalid`]
  );
  await systemQuery(
    "INSERT INTO family_calendar.memberships (user_id, family_id, role) VALUES ($1, $2, 'owner')",
    [userId, familyId]
  );
  cookieJar.clear();
  const session = await getSession();
  session.userId = userId;
  session.familyId = familyId;
  await session.save();
});

beforeEach(async () => {
  // Tenant-scoped, so this empties the test family only. Events cascade.
  await inFamily(() => query('DELETE FROM family_calendar.family_members'));
});

afterAll(async () => {
  // families cascade to members, events and memberships.
  await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
  await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
  cookieJar.clear();
});

describe('createEventAction links a typed full name to the existing person', () => {
  it('attaches "Miriam Cohen" to the Miriam Cohen already in the tree instead of forking a second Miriam', async () => {
    const miriam = await addPerson('Miriam', 'Cohen');

    expect(await createEventAction(occasion('Miriam Cohen', { event_type: 'birthday', event_type_label: undefined }))).toEqual({});

    expect((await everyone()).map(p => p.id)).toEqual([miriam]);
    expect(await occasionsOf(miriam)).toBe(1);
  });

  it('two occasions typed for the same new full name belong to ONE person', async () => {
    expect(await createEventAction(occasion('Avraham Mizrahi', { event_type: 'birthday', event_type_label: undefined }))).toEqual({});
    expect(await createEventAction(occasion('  avraham   MIZRAHI '))).toEqual({});

    const people = await everyone();
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: 'Avraham', last_name: 'Mizrahi' });
    expect(await occasionsOf(people[0].id)).toBe(2);
  });

  it('a shared given name with a different surname is a different person', async () => {
    const cohen = await addPerson('Miriam', 'Cohen');

    expect(await createEventAction(occasion('Miriam Adler'))).toEqual({});

    const people = await everyone();
    expect(people).toHaveLength(2);
    expect(people[1]).toMatchObject({ name: 'Miriam', last_name: 'Adler' });
    expect(await occasionsOf(cohen)).toBe(0);
  });

  it('still finds a legacy row whose whole name sits in the given-name column', async () => {
    const dovid = await addPerson('Dovid Levi', null);

    expect(await createEventAction(occasion('Dovid Levi'))).toEqual({});

    expect((await everyone()).map(p => p.id)).toEqual([dovid]);
    expect(await occasionsOf(dovid)).toBe(1);
  });

  it('refuses to guess between two people with the same name, and writes nothing', async () => {
    const first = await addPerson('Rivka', 'Adler');
    const second = await addPerson('Rivka', 'Adler');

    const result = await createEventAction(occasion('Rivka Adler'));

    expect(result.error).toContain('Rivka Adler');
    expect((await everyone()).map(p => p.id)).toEqual([first, second]);
    expect(await occasionsOf(first)).toBe(0);
    expect(await occasionsOf(second)).toBe(0);
  });

  it('an explicit family_member_id still wins over the typed name', async () => {
    const cohen = await addPerson('Miriam', 'Cohen');
    const adler = await addPerson('Miriam', 'Adler');

    expect(await createEventAction(occasion('Miriam Cohen', { family_member_id: adler }))).toEqual({});

    expect(await occasionsOf(adler)).toBe(1);
    expect(await occasionsOf(cohen)).toBe(0);
  });
});
