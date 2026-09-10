import { randomBytes, createHash } from 'crypto';
import { query, systemQuery } from '@/lib/db';
import { getMembership, type MembershipRole } from '@/lib/users';

export type TokenKind = 'shared' | 'personal' | 'invite';

/** The membership role an invite link grants its redeemer. */
export type InviteRole = 'editor' | 'viewer';

export interface AccessTokenRow {
  id: number;
  token_hash: string;
  kind: TokenKind;
  person_id: number | null;
  label: string | null;
  invite_role: InviteRole | null;
  family_id: number;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AccessTokenWithPerson extends AccessTokenRow {
  person_name: string | null;
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function listAccessTokens(): Promise<AccessTokenWithPerson[]> {
  return query<AccessTokenWithPerson>(`
    SELECT t.*, fm.name AS person_name
    FROM family_calendar.access_tokens t
    LEFT JOIN family_calendar.family_members fm ON t.person_id = fm.id
    ORDER BY t.kind, t.created_at DESC
  `);
}

export async function createSharedToken(label: string | null): Promise<string> {
  const token = generateToken();
  const hash = hashToken(token);
  await query(
    `INSERT INTO family_calendar.access_tokens (token_hash, kind, label)
     VALUES ($1, 'shared', $2)`,
    [hash, label]
  );
  return token;
}

export async function rotateSharedToken(label: string | null): Promise<string> {
  await query(
    `UPDATE family_calendar.access_tokens
     SET revoked_at = NOW()
     WHERE kind = 'shared' AND revoked_at IS NULL`
  );
  return createSharedToken(label);
}

export async function createPersonalToken(
  personId: number,
  label: string | null,
): Promise<string> {
  // Regenerating a person's card REVOKES their previous personal links, so
  // reprinting actually kills a leaked/old QR (they used to linger forever).
  // The shared family link is separate and stays permanent.
  await query(
    `UPDATE family_calendar.access_tokens
     SET revoked_at = NOW()
     WHERE kind = 'personal' AND person_id = $1 AND revoked_at IS NULL`,
    [personId]
  );
  const token = generateToken();
  const hash = hashToken(token);
  // Personal card links expire after a year (defense-in-depth for a QR that
  // outlives its purpose); the shared family link is deliberately non-expiring.
  await query(
    `INSERT INTO family_calendar.access_tokens (token_hash, kind, person_id, label, expires_at)
     VALUES ($1, 'personal', $2, $3, NOW() + INTERVAL '1 year')`,
    [hash, personId, label]
  );
  return token;
}

/**
 * Generate fresh personal tokens for a batch of people. Used by the cards page
 * to produce QR-scannable magic links. Regenerating REVOKES each person's prior
 * personal tokens (see createPersonalToken) so old printed cards stop working.
 */
export async function bulkCreatePersonalTokens(
  personIds: number[],
  label: string | null,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  for (const pid of personIds) {
    const token = await createPersonalToken(pid, label);
    result.set(pid, token);
  }
  return result;
}

export async function revokeToken(id: number): Promise<void> {
  await query(
    `UPDATE family_calendar.access_tokens SET revoked_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function resolveToken(token: string): Promise<AccessTokenRow | null> {
  const hash = hashToken(token);
  const rows = await query<AccessTokenRow>(
    `SELECT * FROM family_calendar.access_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [hash]
  );
  return rows[0] ?? null;
}

export async function markTokenUsed(id: number): Promise<void> {
  // Record use AND slide any expiry a year forward — so a fridge card that's still
  // being used doesn't silently stop working. (The permanent shared link has no
  // expires_at, so COALESCE leaves it untouched.)
  await query(
    `UPDATE family_calendar.access_tokens
     SET last_used_at = NOW(),
         expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE NOW() + INTERVAL '1 year' END
     WHERE id = $1`,
    [id]
  );
}

// ---------------------------------------------------------------------------
// Family invites (Task 3.2) — the viral loop. An owner mints a link scoped to
// THEIR family; a signed-in Google user who opens it joins that family with the
// role baked into the invite.
// ---------------------------------------------------------------------------

/**
 * Mint a family INVITE link and return the raw (un-hashed) token — shown once.
 *
 * Tenant-scoped: runs under the owner's active family (a requireAdmin guard sets
 * tenant context before this is called), so the RLS INSERT lands in that family
 * and `family_id` is auto-stamped by the GUC column default. `invite_role` is the
 * role the redeemer receives. Invites expire after 30 days as defense-in-depth
 * for a link that gets forwarded around a family WhatsApp and lingers.
 */
export interface InviteTokenRow {
  id: number;
  invite_role: InviteRole;
  label: string | null;
  created_at: string;
  /** Computed in SQL (expires_at <= NOW()) so the UI never touches the clock. */
  expired: boolean;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * List this family's invite links, newest first. Tenant-scoped: RLS restricts the
 * rows to the caller's active family, so a requireAdmin guard (which enters tenant
 * context) must run before this. Used by the owner's invite admin surface. Expiry
 * is derived in SQL against NOW() so the render path stays a pure function.
 */
export async function listInviteTokens(): Promise<InviteTokenRow[]> {
  return query<InviteTokenRow>(
    `SELECT id, invite_role, label, created_at, last_used_at, revoked_at,
            (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
       FROM family_calendar.access_tokens
      WHERE kind = 'invite'
      ORDER BY created_at DESC`
  );
}

export async function createInviteToken(
  role: InviteRole,
  label?: string | null,
): Promise<string> {
  const token = generateToken();
  const hash = hashToken(token);
  await query(
    `INSERT INTO family_calendar.access_tokens (token_hash, kind, invite_role, label, expires_at)
     VALUES ($1, 'invite', $2, $3, NOW() + INTERVAL '30 days')`,
    [hash, role, label ?? null]
  );
  return token;
}

/** Why an invite link cannot be used — or 'live' when it can. */
export type InviteStatus = 'live' | 'expired' | 'revoked' | 'unknown';

export interface InvitePeek {
  status: InviteStatus;
  /** Present for every status EXCEPT 'unknown' — see peekInvite. */
  familyId?: number;
  familyName?: string;
  familyNameHe?: string | null;
  role?: InviteRole;
}

/**
 * Look an invite link up WITHOUT redeeming it, so /join/<token> can name the
 * family before it asks anyone to sign in.
 *
 * Strictly read-only, and deliberately does not stamp `last_used_at`: this runs on
 * every render of the landing page, including a link-preview fetch from WhatsApp,
 * and marking those as "used" would show the owner activity that never happened.
 * Redemption stays in redeemInvite(), called from a POSTed server action.
 *
 * CROSS-TENANT read by design, exactly like redeemInvite: the visitor has no
 * active family, so there is no tenant GUC to scope access_tokens by, and the
 * app's DB role is not BYPASSRLS. The privileged work is encapsulated in the
 * SECURITY DEFINER function family_calendar.peek_invite (migrate-v15.sql) rather
 * than granting the app ambient RLS-bypass; systemQuery here just calls it.
 *
 * An expired or revoked link still returns its family — the token is 256-bit, so
 * whoever holds one was given it, and naming the family is what lets the page say
 * "ask whoever sent you the <family> link for a new one". A token that does not
 * exist (garbage, mistyped, or a shared/personal card link) returns
 * `{ status: 'unknown' }` with nothing else, and the caller falls back to the
 * intentionally opaque /join-invalid page.
 */
export async function peekInvite(rawToken: string): Promise<InvitePeek> {
  const hash = hashToken(rawToken);
  const rows = await systemQuery<{
    out_family_id: number;
    out_family_name: string;
    out_family_name_he: string | null;
    out_role: InviteRole;
    out_status: 'live' | 'expired' | 'revoked';
  }>(
    `SELECT out_family_id, out_family_name, out_family_name_he, out_role, out_status
       FROM family_calendar.peek_invite($1)`,
    [hash]
  );
  const row = rows[0];
  if (!row) return { status: 'unknown' };
  return {
    status: row.out_status,
    familyId: row.out_family_id,
    familyName: row.out_family_name,
    familyNameHe: row.out_family_name_he,
    role: row.out_role,
  };
}

/**
 * Redeem an invite link for a signed-in user, joining them to the invite's family.
 *
 * CROSS-TENANT read by design: the joiner has NO active family yet, so there is no
 * tenant context to scope by — this is the ONE legitimate place we look an
 * access_token up across all families. We therefore use systemQuery (which bypasses
 * RLS) to find the row by its unguessable sha256 hash, then create the membership.
 * Every OTHER access-token read stays tenant-scoped.
 *
 * Validates: the token exists, is an 'invite', is not revoked, and is not expired.
 * Creating the membership uses ON CONFLICT (user_id, family_id) DO NOTHING so a
 * user who already belongs (or double-clicks the link) is treated as success and
 * their stored role is never downgraded. Returns the joined family + the role the
 * user ACTUALLY holds, or an { error } the caller renders as a friendly page.
 *
 * ⚠ The SQL function returns the TOKEN's role, not the redeemer's — see below.
 */
export async function redeemInvite(
  rawToken: string,
  userId: number,
): Promise<{ familyId: number; role: MembershipRole } | { error: string }> {
  const hash = hashToken(rawToken);

  // The joiner has NO active family, so there is no tenant GUC to scope by — and
  // the app's DB role is not BYPASSRLS, so a direct SELECT on the RLS-scoped
  // access_tokens table returns nothing. This lookup-and-join is therefore done
  // by the SECURITY DEFINER function family_calendar.redeem_invite (see
  // migrate-v11.sql): the ONE legitimate cross-tenant operation, encapsulated and
  // auditable instead of granting the app ambient RLS-bypass. It validates the
  // token, creates the membership (ON CONFLICT DO NOTHING — never a downgrade),
  // stamps usage, and returns the family + role — or no row for a bad invite.
  //
  // systemQuery here runs OUTSIDE tenant scope on purpose (no GUC); the function
  // does the privileged work, not this connection.
  const rows = await systemQuery<{ out_family_id: number; out_role: InviteRole }>(
    `SELECT out_family_id, out_role FROM family_calendar.redeem_invite($1, $2)`,
    [hash, userId]
  );
  const redeemed = rows[0];
  if (!redeemed) {
    return { error: 'This invite link is invalid or has expired.' };
  }

  // ── Trust the MEMBERSHIP, not the token ──
  // redeem_invite() returns the role baked into the invite, and its INSERT is
  // ON CONFLICT DO NOTHING — so for a user who already belongs, the database keeps
  // their real role while the function still hands back the token's. The caller
  // writes this value straight into the session cookie, and proxy.ts gates
  // /admin/* on `session.role !== 'owner'`.
  //
  // The consequence was a live foot-gun: an owner clicking their OWN invite link
  // to check that it works got a `viewer` session, lost the admin pages and the
  // 🔑 Access link, and — below two memberships the family switcher does not even
  // render — could only recover by signing out. So re-read the role the user
  // actually holds and return that. The token decides what a NEW member gets; it
  // must never decide what an existing one keeps.
  const membership = await getMembership(userId, redeemed.out_family_id);
  return {
    familyId: redeemed.out_family_id,
    role: membership?.role ?? redeemed.out_role,
  };
}
