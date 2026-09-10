import { systemQuery, withSystemTransaction } from '@/lib/db';

export type MembershipRole = 'owner' | 'editor' | 'viewer';

export interface Membership {
  family_id: number;
  role: MembershipRole;
  member_person_id: number | null;
  family_name: string;
  family_name_he: string | null;
}

interface UserRow {
  id: number;
}

interface MembershipRow {
  family_id: number;
  role: MembershipRole;
  member_person_id: number | null;
  family_name: string;
  family_name_he: string | null;
}

export async function upsertUser(input: {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}): Promise<{ id: number }> {
  const rows = await systemQuery<UserRow>(
    `INSERT INTO family_calendar.users (google_sub, email, display_name, photo_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub) DO UPDATE
       SET email        = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           photo_url    = EXCLUDED.photo_url
     RETURNING id`,
    [input.sub, input.email, input.name ?? null, input.picture ?? null]
  );
  return { id: rows[0].id };
}

/**
 * Onboarding: create a brand-new family and make `userId` its OWNER, atomically.
 * Both inserts run in one system-scoped transaction (see withSystemTransaction) so
 * a family can never be left orphaned without its creator's membership. Returns the
 * new family id. `nameHe` is optional (stored NULL when absent). Callers must have
 * already validated/trimmed the inputs.
 */
export async function createFamilyWithOwner(
  userId: number,
  name: string,
  nameHe?: string | null
): Promise<{ familyId: number }> {
  return withSystemTransaction(async (run) => {
    // branches = '{}' (empty, NOT null) on purpose. NULL means "predates per-family
    // branches, inherit this deployment's FAMILY_BRANCHES" — which for a brand-new,
    // unrelated family would mean wearing the operator's real family surnames as
    // their own branch chips. A new family starts with no sides defined: everyone
    // renders neutral until an owner adds their own at /admin/branches.
    const [family] = await run<{ id: number }>(
      `INSERT INTO family_calendar.families (name, name_he, branches)
       VALUES ($1, $2, '{}') RETURNING id`,
      [name, nameHe ?? null]
    );
    await run(
      `INSERT INTO family_calendar.memberships (user_id, family_id, role)
       VALUES ($1, $2, 'owner')`,
      [userId, family.id]
    );
    return { familyId: family.id };
  });
}

export async function getMembershipsForUser(userId: number): Promise<Membership[]> {
  return systemQuery<MembershipRow>(
    `SELECT m.family_id, m.role, m.member_person_id, f.name AS family_name, f.name_he AS family_name_he
     FROM family_calendar.memberships m
     JOIN family_calendar.families f ON f.id = m.family_id
     WHERE m.user_id = $1
     ORDER BY m.created_at DESC`,
    [userId]
  );
}

export async function getMembership(
  userId: number,
  familyId: number
): Promise<Membership | null> {
  const rows = await systemQuery<MembershipRow>(
    `SELECT m.family_id, m.role, m.member_person_id, f.name AS family_name, f.name_he AS family_name_he
     FROM family_calendar.memberships m
     JOIN family_calendar.families f ON f.id = m.family_id
     WHERE m.user_id = $1 AND m.family_id = $2`,
    [userId, familyId]
  );
  return rows[0] ?? null;
}

export interface FamilyNames {
  id: number;
  name: string;
  name_he: string | null;
}

/**
 * A family's display names by id. `families` is a non-RLS table, so this is a
 * plain systemQuery — used e.g. by the invite /join page to greet a new member
 * with the family they just joined (they have no tenant context yet).
 */
export async function getFamilyById(familyId: number): Promise<FamilyNames | null> {
  const rows = await systemQuery<FamilyNames>(
    'SELECT id, name, name_he FROM family_calendar.families WHERE id = $1',
    [familyId]
  );
  return rows[0] ?? null;
}

export interface ActiveFamily {
  id: number;
  name: string;
}

/** All families, for machine callers (n8n) that need to iterate every tenant. */
export async function listActiveFamilies(): Promise<ActiveFamily[]> {
  return systemQuery<ActiveFamily>(
    'SELECT id, name FROM family_calendar.families ORDER BY id'
  );
}
