import { describe, it, expect } from 'vitest';
import { systemQuery, query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { createInviteToken, redeemInvite, hashToken } from '@/lib/tokens';
import { upsertUser } from '@/lib/users';

// access_tokens is an RLS table and the app's DB role is NOT bypass-RLS, so any
// SELECT on it must run under tenant scope (runWithTenant + query). systemQuery is
// only for the non-RLS tables (families, users, memberships).

// Requires DATABASE_URL pointing at staging Postgres with migration v11 applied
// (access_tokens.invite_role + 'invite' kind). Run as app_user so RLS is live.

/** Make a throwaway family and return its id (system-scoped: families is non-RLS). */
async function makeFamily(name: string): Promise<number> {
  const [row] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.families (name) VALUES ($1) RETURNING id',
    [name]
  );
  return row.id;
}

async function makeUser(tag: string): Promise<number> {
  const sub = `test-invite-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { id } = await upsertUser({ sub, email: `${sub}@example.com` });
  return id;
}

async function cleanup(opts: { familyIds?: number[]; userIds?: number[] }) {
  for (const uid of opts.userIds ?? []) {
    await systemQuery('DELETE FROM family_calendar.memberships WHERE user_id = $1', [uid]);
    await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [uid]);
  }
  for (const fid of opts.familyIds ?? []) {
    // access_tokens + memberships FK-cascade on family delete; be explicit anyway.
    await systemQuery('DELETE FROM family_calendar.memberships WHERE family_id = $1', [fid]);
    await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [fid]);
  }
}

describe('createInviteToken', () => {
  it('mints an invite row stamped with the owner tenant family_id and the intended role', async () => {
    const familyId = await makeFamily('Invite Mint Family');
    try {
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('editor', 'cousins')
      );
      expect(typeof raw).toBe('string');
      expect(raw.length).toBeGreaterThan(20);

      // access_tokens is RLS-scoped — read it under the same tenant.
      const rows = await runWithTenant(familyId, () =>
        query<{
          family_id: number;
          kind: string;
          invite_role: string;
          label: string | null;
          person_id: number | null;
        }>(
          'SELECT family_id, kind, invite_role, label, person_id FROM family_calendar.access_tokens WHERE token_hash = $1',
          [hashToken(raw)]
        )
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].family_id).toBe(familyId); // auto-stamped from tenant GUC
      expect(rows[0].kind).toBe('invite');
      expect(rows[0].invite_role).toBe('editor');
      expect(rows[0].label).toBe('cousins');
      expect(rows[0].person_id).toBeNull();
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });
});

describe('redeemInvite', () => {
  it('creates a membership with the invite role/family and returns them', async () => {
    const familyId = await makeFamily('Redeem OK Family');
    const userId = await makeUser('ok');
    try {
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('viewer', 'aunt')
      );

      const result = await redeemInvite(raw, userId);
      expect(result).toEqual({ familyId, role: 'viewer' });

      const memberships = await systemQuery<{ role: string }>(
        'SELECT role FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe('viewer');

      // last_used_at is stamped (read under tenant scope — RLS table)
      const [tok] = await runWithTenant(familyId, () =>
        query<{ last_used_at: string | null }>(
          'SELECT last_used_at FROM family_calendar.access_tokens WHERE token_hash = $1',
          [hashToken(raw)]
        )
      );
      expect(tok.last_used_at).not.toBeNull();
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });

  it('is idempotent: redeeming twice still succeeds and does not duplicate the membership', async () => {
    const familyId = await makeFamily('Redeem Twice Family');
    const userId = await makeUser('twice');
    try {
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('editor', null)
      );

      const first = await redeemInvite(raw, userId);
      const second = await redeemInvite(raw, userId);
      expect(first).toEqual({ familyId, role: 'editor' });
      expect(second).toEqual({ familyId, role: 'editor' });

      const memberships = await systemQuery(
        'SELECT 1 FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(memberships).toHaveLength(1); // no dup
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });

  it('does NOT downgrade/overwrite an existing membership role on re-redeem', async () => {
    // A user who is already an OWNER redeeming a 'viewer' invite must not be demoted.
    const familyId = await makeFamily('Redeem NoDowngrade Family');
    const userId = await makeUser('owner');
    try {
      await systemQuery(
        "INSERT INTO family_calendar.memberships (user_id, family_id, role) VALUES ($1, $2, 'owner')",
        [userId, familyId]
      );
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('viewer', null)
      );

      const result = await redeemInvite(raw, userId);
      // Treated as success (already a member), returns the family; role stays owner.
      expect(result).toHaveProperty('familyId', familyId);

      const [m] = await systemQuery<{ role: string }>(
        'SELECT role FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(m.role).toBe('owner'); // NOT downgraded to viewer
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });

  it('rejects a revoked invite', async () => {
    const familyId = await makeFamily('Redeem Revoked Family');
    const userId = await makeUser('revoked');
    try {
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('viewer', null)
      );
      await runWithTenant(familyId, () =>
        query(
          'UPDATE family_calendar.access_tokens SET revoked_at = NOW() WHERE token_hash = $1',
          [hashToken(raw)]
        )
      );

      const result = await redeemInvite(raw, userId);
      expect(result).toHaveProperty('error');

      const memberships = await systemQuery(
        'SELECT 1 FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(memberships).toHaveLength(0);
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });

  it('rejects an expired invite', async () => {
    const familyId = await makeFamily('Redeem Expired Family');
    const userId = await makeUser('expired');
    try {
      const raw = await runWithTenant(familyId, () =>
        createInviteToken('viewer', null)
      );
      await runWithTenant(familyId, () =>
        query(
          "UPDATE family_calendar.access_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token_hash = $1",
          [hashToken(raw)]
        )
      );

      const result = await redeemInvite(raw, userId);
      expect(result).toHaveProperty('error');
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });

  it('rejects a garbage / non-existent token', async () => {
    const userId = await makeUser('garbage');
    try {
      const result = await redeemInvite('not-a-real-token-at-all', userId);
      expect(result).toHaveProperty('error');
    } finally {
      await cleanup({ userIds: [userId] });
    }
  });

  it('rejects a non-invite (shared/personal) token used as an invite', async () => {
    const familyId = await makeFamily('Redeem WrongKind Family');
    const userId = await makeUser('wrongkind');
    try {
      // Hand-insert a 'shared' token in this family (under tenant scope; family_id
      // auto-stamps from the GUC default — RLS WITH CHECK requires the match).
      const rawShared = 'shared-raw-token-' + Math.random().toString(36).slice(2);
      await runWithTenant(familyId, () =>
        query(
          "INSERT INTO family_calendar.access_tokens (token_hash, kind) VALUES ($1, 'shared')",
          [hashToken(rawShared)]
        )
      );

      const result = await redeemInvite(rawShared, userId);
      expect(result).toHaveProperty('error');

      const memberships = await systemQuery(
        'SELECT 1 FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(memberships).toHaveLength(0);
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
    }
  });
});
