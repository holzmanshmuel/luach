import { describe, it, expect } from 'vitest';
import { systemQuery, query } from '@/lib/db';
import { deleteFamilies } from '@/test-stubs/families';
import { runWithTenant } from '@/lib/tenant';
import { createInviteToken, redeemInvite, peekInvite, hashToken } from '@/lib/tokens';
import { upsertUser } from '@/lib/users';

// access_tokens is an RLS table and the app's DB role is NOT bypass-RLS, so any
// SELECT on it must run under tenant scope (runWithTenant + query). systemQuery is
// only for the non-RLS tables (families, users, memberships).

// Requires DATABASE_URL pointing at staging Postgres with migrations v11 (invite
// tokens + redeem_invite) and v15 (peek_invite) applied. Run as app_user so RLS is
// live — and note that both SECURITY DEFINER functions must be GRANTed to whichever
// role the suite connects as, or these fail with "permission denied for function".

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
    await deleteFamilies(fid);
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

      // And — the half this test used to miss — the RETURNED role must be the
      // owner's too. The caller writes it straight into the session cookie and
      // proxy.ts gates /admin/* on it, so returning the token's 'viewer' locked a
      // real owner out of their own admin pages the moment they clicked their own
      // invite link to check it. A correct database row is not enough; the value
      // handed back is the one that decides what the user can do next.
      expect(result).toHaveProperty('role', 'owner');
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

  it('an owner who re-redeems keeps owner across BOTH calls', async () => {
    // The live-bug shape: owners click their own invite link to check that it works,
    // and some click it twice. Every call must hand back 'owner', because the caller
    // writes the returned role into the session and proxy.ts gates /admin/* on it.
    const familyId = await makeFamily('Redeem Owner Twice Family');
    const userId = await makeUser('ownertwice');
    try {
      await systemQuery(
        "INSERT INTO family_calendar.memberships (user_id, family_id, role) VALUES ($1, $2, 'owner')",
        [userId, familyId]
      );
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));

      expect(await redeemInvite(raw, userId)).toEqual({ familyId, role: 'owner' });
      expect(await redeemInvite(raw, userId)).toEqual({ familyId, role: 'owner' });

      const [m] = await systemQuery<{ role: string }>(
        'SELECT role FROM family_calendar.memberships WHERE user_id = $1 AND family_id = $2',
        [userId, familyId]
      );
      expect(m.role).toBe('owner');
    } finally {
      await cleanup({ familyIds: [familyId], userIds: [userId] });
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

/**
 * peekInvite is what lets /join/<token> name the family BEFORE anyone signs in, and
 * it runs on every render of that page — including a WhatsApp link-preview fetch. So
 * the two things worth pinning are that it distinguishes all four outcomes, and that
 * it writes absolutely nothing.
 */
describe('peekInvite', () => {
  it('returns the family, the role and live status for a usable invite', async () => {
    const familyId = await makeFamily('Peek Live Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('editor', 'cousins'));

      const peek = await peekInvite(raw);
      expect(peek).toEqual({
        status: 'live',
        familyId,
        familyName: 'Peek Live Family',
        familyNameHe: null,
        role: 'editor',
      });
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('returns the Hebrew family name when the family has one', async () => {
    // The invite landing page shows the Hebrew name to a Hebrew reader, so the peek
    // has to carry both — the visitor has no tenant and cannot look the family up.
    const [row] = await systemQuery<{ id: number }>(
      "INSERT INTO family_calendar.families (name, name_he) VALUES ('Peek Bilingual Family', 'משפחת דוגמה') RETURNING id"
    );
    const familyId = row.id;
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));
      const peek = await peekInvite(raw);
      expect(peek.familyName).toBe('Peek Bilingual Family');
      expect(peek.familyNameHe).toBe('משפחת דוגמה');
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('reports an EXPIRED invite as expired, and still names the family', async () => {
    // Naming the family on a dead link is the deliberate call that turns a dead end
    // into "ask whoever sent you the <family> link for a new one". The token is
    // 256-bit, so whoever presents one was handed it.
    const familyId = await makeFamily('Peek Expired Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));
      await runWithTenant(familyId, () =>
        query(
          "UPDATE family_calendar.access_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token_hash = $1",
          [hashToken(raw)]
        )
      );

      const peek = await peekInvite(raw);
      expect(peek.status).toBe('expired');
      expect(peek.familyId).toBe(familyId);
      expect(peek.familyName).toBe('Peek Expired Family');
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('reports a REVOKED invite as revoked, separately from expired', async () => {
    const familyId = await makeFamily('Peek Revoked Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));
      await runWithTenant(familyId, () =>
        query(
          'UPDATE family_calendar.access_tokens SET revoked_at = NOW() WHERE token_hash = $1',
          [hashToken(raw)]
        )
      );

      const peek = await peekInvite(raw);
      expect(peek.status).toBe('revoked');
      expect(peek.familyName).toBe('Peek Revoked Family');
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('reports revoked ahead of expired when a link is both', async () => {
    // An owner who turned a link off should be told it was turned off, not that it
    // aged out — the two have different answers.
    const familyId = await makeFamily('Peek Both Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));
      await runWithTenant(familyId, () =>
        query(
          "UPDATE family_calendar.access_tokens SET revoked_at = NOW(), expires_at = NOW() - INTERVAL '1 day' WHERE token_hash = $1",
          [hashToken(raw)]
        )
      );
      expect((await peekInvite(raw)).status).toBe('revoked');
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('returns unknown — and NOTHING else — for a garbage token', async () => {
    // No family name, no role, no reason. This is the case that keeps /join-invalid
    // opaque; leaking anything here would make the page an oracle.
    expect(await peekInvite('not-a-real-token-at-all')).toEqual({ status: 'unknown' });
  });

  it('returns unknown for a shared/personal card token used as an invite', async () => {
    const familyId = await makeFamily('Peek WrongKind Family');
    try {
      const rawShared = 'shared-raw-token-' + Math.random().toString(36).slice(2);
      await runWithTenant(familyId, () =>
        query(
          "INSERT INTO family_calendar.access_tokens (token_hash, kind) VALUES ($1, 'shared')",
          [hashToken(rawShared)]
        )
      );
      expect(await peekInvite(rawShared)).toEqual({ status: 'unknown' });
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('does NOT stamp last_used_at — a link preview must not mark an invite as used', async () => {
    // WhatsApp and Telegram fetch shared URLs to build a preview, and this page also
    // re-renders on every refresh. If the peek stamped usage, the owner's admin panel
    // would report activity that never happened.
    const familyId = await makeFamily('Peek NoStamp Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('viewer', null));

      await peekInvite(raw);
      await peekInvite(raw);

      const [tok] = await runWithTenant(familyId, () =>
        query<{ last_used_at: string | null }>(
          'SELECT last_used_at FROM family_calendar.access_tokens WHERE token_hash = $1',
          [hashToken(raw)]
        )
      );
      expect(tok.last_used_at).toBeNull();
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });

  it('creates no membership, ever', async () => {
    // It is the READ-ONLY companion to redeemInvite. If a render could join somebody,
    // the whole point of moving redemption off a GET would be lost.
    const familyId = await makeFamily('Peek NoJoin Family');
    try {
      const raw = await runWithTenant(familyId, () => createInviteToken('editor', null));
      await peekInvite(raw);

      const memberships = await systemQuery(
        'SELECT 1 FROM family_calendar.memberships WHERE family_id = $1',
        [familyId]
      );
      expect(memberships).toHaveLength(0);
    } finally {
      await cleanup({ familyIds: [familyId] });
    }
  });
});
