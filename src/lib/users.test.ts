import { describe, it, expect } from 'vitest';
import { systemQuery } from '@/lib/db';
import {
  upsertUser,
  getMembershipsForUser,
  getMembership,
  createFamilyWithOwner,
} from '@/lib/users';

// Requires DATABASE_URL pointing at staging Postgres with migration v11+ applied
// (families, users, memberships tables in family_calendar schema).

describe('upsertUser', () => {
  it('inserts a new user and returns an id', async () => {
    const sub = `test-sub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let userId: number | null = null;
    try {
      const result = await upsertUser({ sub, email: 'test@example.com', name: 'Test User' });
      expect(typeof result.id).toBe('number');
      expect(result.id).toBeGreaterThan(0);
      userId = result.id;
    } finally {
      if (userId !== null) {
        await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
      }
    }
  });

  it('updates an existing user on conflict and returns the same id', async () => {
    const sub = `test-sub-update-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let userId: number | null = null;
    try {
      const first = await upsertUser({ sub, email: 'first@example.com', name: 'First' });
      userId = first.id;

      const second = await upsertUser({ sub, email: 'updated@example.com', name: 'Updated' });
      // Same id — row was updated, not re-inserted
      expect(second.id).toBe(first.id);

      // Verify the email was actually updated in DB
      const rows = await systemQuery<{ email: string }>(
        'SELECT email FROM family_calendar.users WHERE id = $1',
        [userId]
      );
      expect(rows[0].email).toBe('updated@example.com');
    } finally {
      if (userId !== null) {
        await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
      }
    }
  });
});

describe('createFamilyWithOwner', () => {
  it('creates the family and an owner membership, returning the new family id', async () => {
    const sub = `test-sub-onboard-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let userId: number | null = null;
    let familyId: number | null = null;

    try {
      const userRow = await upsertUser({ sub, email: 'onboard@example.com' });
      userId = userRow.id;

      const result = await createFamilyWithOwner(userId, 'Onboard Test Family', 'משפחת בדיקה');
      expect(typeof result.familyId).toBe('number');
      expect(result.familyId).toBeGreaterThan(0);
      familyId = result.familyId;

      // Family row exists with both names
      const fams = await systemQuery<{ name: string; name_he: string | null }>(
        'SELECT name, name_he FROM family_calendar.families WHERE id = $1',
        [familyId]
      );
      expect(fams).toHaveLength(1);
      expect(fams[0].name).toBe('Onboard Test Family');
      expect(fams[0].name_he).toBe('משפחת בדיקה');

      // The creator is the OWNER of the new family
      const membership = await getMembership(userId, familyId);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('owner');
      expect(membership!.family_name).toBe('Onboard Test Family');
    } finally {
      if (userId !== null) {
        await systemQuery('DELETE FROM family_calendar.memberships WHERE user_id = $1', [userId]);
        await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
      }
      if (familyId !== null) {
        await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
      }
    }
  });

  it('stores NULL for name_he when the Hebrew name is omitted', async () => {
    const sub = `test-sub-onboard-nohe-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let userId: number | null = null;
    let familyId: number | null = null;

    try {
      const userRow = await upsertUser({ sub, email: 'onboard-nohe@example.com' });
      userId = userRow.id;

      const result = await createFamilyWithOwner(userId, 'No Hebrew Family');
      familyId = result.familyId;

      const fams = await systemQuery<{ name_he: string | null }>(
        'SELECT name_he FROM family_calendar.families WHERE id = $1',
        [familyId]
      );
      expect(fams[0].name_he).toBeNull();
    } finally {
      if (userId !== null) {
        await systemQuery('DELETE FROM family_calendar.memberships WHERE user_id = $1', [userId]);
        await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
      }
      if (familyId !== null) {
        await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
      }
    }
  });
});

describe('getMembershipsForUser / getMembership', () => {
  it('returns memberships with family_name, and getMembership returns null for a different family', async () => {
    // Seed user
    const sub = `test-sub-memb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let userId: number | null = null;
    let familyId: number | null = null;
    let otherFamilyId: number | null = null;

    try {
      const userRow = await upsertUser({ sub, email: 'memb@example.com' });
      userId = userRow.id;

      // Seed a family
      const [fam] = await systemQuery<{ id: number }>(
        "INSERT INTO family_calendar.families (name) VALUES ('Test Membership Family') RETURNING id"
      );
      familyId = fam.id;

      // Seed a second family (no membership for this user)
      const [other] = await systemQuery<{ id: number }>(
        "INSERT INTO family_calendar.families (name) VALUES ('Other Family') RETURNING id"
      );
      otherFamilyId = other.id;

      // Seed a membership
      await systemQuery(
        `INSERT INTO family_calendar.memberships (user_id, family_id, role)
         VALUES ($1, $2, 'owner')`,
        [userId, familyId]
      );

      // getMembershipsForUser
      const memberships = await getMembershipsForUser(userId);
      expect(memberships.length).toBeGreaterThanOrEqual(1);
      const m = memberships.find(x => x.family_id === familyId);
      expect(m).toBeDefined();
      expect(m!.role).toBe('owner');
      expect(m!.family_name).toBe('Test Membership Family');
      // family_name_he is nullable — this family was seeded without one
      expect(m).toHaveProperty('family_name_he');
      expect(m!.family_name_he).toBeNull();

      // getMembership — correct family
      const single = await getMembership(userId, familyId);
      expect(single).not.toBeNull();
      expect(single!.role).toBe('owner');
      expect(single!.family_name).toBe('Test Membership Family');
      expect(single).toHaveProperty('family_name_he');
      expect(single!.family_name_he).toBeNull();

      // getMembership — family this user has no membership in → null
      const none = await getMembership(userId, otherFamilyId);
      expect(none).toBeNull();
    } finally {
      // Delete membership first (FK), then user and families
      if (userId !== null && familyId !== null) {
        await systemQuery(
          'DELETE FROM family_calendar.memberships WHERE user_id = $1',
          [userId]
        );
      }
      if (userId !== null) {
        await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
      }
      if (familyId !== null) {
        await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
      }
      if (otherFamilyId !== null) {
        await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [otherFamilyId]);
      }
    }
  });
});
