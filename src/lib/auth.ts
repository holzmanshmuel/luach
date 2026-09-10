import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { enterTenant, runWithTenant } from '@/lib/tenant';
import { getMembership, type MembershipRole } from '@/lib/users';

export interface SessionData {
  /** The signed-in user (Google account). Signed in ⇔ `!!userId`. */
  userId?: number;
  /** Cached from the user row — for display; never trusted for authorization. */
  userEmail?: string;
  /** The active family (tenant) for this session. */
  familyId?: number;
  /**
   * Cached membership role for the active family — a UI hint only. Guards always
   * re-read the live role from the DB via getMembership; never trust this for a
   * privilege decision.
   */
  role?: MembershipRole;
  /** The person in the family this user maps to (member_person_id), if any. */
  personId?: number;
  /** Families the user chose to view MERGED (combined view). ≤1 ⇒ single mode; ≥2 ⇒ combined. */
  viewFamilyIds?: number[];
  /** Transient CSRF token for the Google OAuth round-trip. */
  oauthState?: string;
  /**
   * Same-origin path to return the user to after a successful Google sign-in.
   * Set from a sanitized `?next=` param on the /api/auth/google entry route and
   * consumed (then cleared) on the callback. Only ever a validated local path —
   * see sanitizeNext — so it can't be used for an open redirect.
   */
  postLoginRedirect?: string;
}

function requireSessionPassword(): string {
  const pw = process.env.SESSION_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error(
      'SESSION_PASSWORD is required (32+ characters). Generate one with: openssl rand -hex 32'
    );
  }
  return pw;
}

export const sessionOptions: SessionOptions = {
  // Lazy getter: throws at request time if the secret is missing, rather than
  // silently falling back to a known string (which would make cookies forgeable).
  get password() {
    return requireSessionPassword();
  },
  cookieName: 'family-calendar-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Pure role → capability decision. Extracted so the privilege ladder is testable
 * without a request/cookie. `owner` ⊃ `editor` ⊃ `viewer`.
 */
export type Action = 'view' | 'edit' | 'delete';
export function roleAllows(role: MembershipRole, action: Action): boolean {
  switch (action) {
    case 'view':
      return role === 'owner' || role === 'editor' || role === 'viewer';
    case 'edit':
      return role === 'owner' || role === 'editor';
    case 'delete':
      return role === 'owner';
  }
}

/** The verified caller: who they are, and which family they are acting in. */
export interface VerifiedTenant {
  familyId: number;
  role: MembershipRole;
  personId: number | null;
}

/**
 * SOFT tenant bootstrap for read renders. Returns the established tenant + live
 * role, or null when there's no signed-in user / active family / live membership
 * — it NEVER throws, so a signed-out (or just-removed) user renders as a guest
 * rather than crashing the page. On success it has already called enterTenant(),
 * so subsequent query() calls in the same async context are scoped to the family.
 *
 * Never trusts the cookie's cached role — the role is re-read live from the DB.
 * requireAuth is built on top of this (see below) so the two can't drift.
 */
export async function establishTenant(): Promise<VerifiedTenant | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return null;
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership) return null;
  enterTenant(session.familyId);
  return {
    familyId: session.familyId,
    role: membership.role,
    personId: session.personId ?? null,
  };
}

/*
 * ── WHY A SERVER ACTION NEEDS A WRAPPER, NOT A BARE GUARD ────────────────────
 *
 * Every guard below ends by calling `enterTenant()`. That is enough for a PAGE:
 * during an RSC render React's `cache()` memoizes the request-scoped holder, so a
 * family written inside an awaited guard is still there when the guard resolves
 * back into the render, and the next `query()` is scoped.
 *
 * It is NOT enough inside a Server Action. There `cache()` does not memoize per
 * request, and `AsyncLocalStorage.enterWith()` binds only the callee's own
 * continuation — so the moment `await requireEditor()` resolves back to the
 * action, the action is running in its ORIGINAL context with no tenant, and the
 * very next `query()` throws
 *   "No tenant context: query() called without an active family."
 * That asymmetry is why every page rendered perfectly while every add, edit and
 * delete in the app failed.
 *
 * `runWithTenant()` uses `AsyncLocalStorage.run()`, which wraps its callback
 * unambiguously, and `getFamilyId()` reads that store first. So a Server Action
 * must put its body INSIDE the tenant callback: use the `with*` wrappers below,
 * never a bare `await require*()` followed by `query()`. Each wrapper shares its
 * verification with the matching guard, so the two cannot drift.
 */

/** Shared by requireAuth + withAuth so the check lives in exactly one place. */
async function verifyAuth(): Promise<VerifiedTenant> {
  const tenant = await establishTenant();
  if (!tenant) {
    throw new Error('Unauthorized');
  }
  return tenant;
}

/**
 * Throws unless the session has a signed-in user, an active family, and a live
 * membership in it. Verifies the membership against the DB (never trusts the
 * cookie's cached role), then establishes tenant context so downstream query()
 * calls are scoped to this family. Implemented on top of establishTenant() so
 * the membership-check + tenant-entry logic lives in exactly one place.
 *
 * PAGES only. In a Server Action use withAuth() — see the note above.
 */
export async function requireAuth(): Promise<void> {
  await verifyAuth();
}

/**
 * requireAuth() for Server Actions: verifies the caller, then runs `fn` with
 * tenant context that survives into it. Throws 'Unauthorized' exactly as
 * requireAuth() does, before `fn` is ever called.
 */
export async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  const { familyId } = await verifyAuth();
  return runWithTenant(familyId, fn);
}

/** Shared by requireAdmin + withAdmin + withAdminOrError. Null = not the owner. */
async function verifyAdmin(): Promise<number | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return null;
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership || membership.role !== 'owner') return null;
  enterTenant(session.familyId);
  return session.familyId;
}

/**
 * Throws unless the signed-in user is the OWNER of the active family (verified
 * live). Establishes tenant context on success. Replaces the old password-admin.
 *
 * PAGES only. In a Server Action use withAdmin() / withAdminOrError().
 */
export async function requireAdmin(): Promise<void> {
  if ((await verifyAdmin()) === null) {
    throw new Error('Admin access required');
  }
}

/**
 * requireAdmin() for Server Actions: the same live owner check, the same thrown
 * 'Admin access required', and `fn` runs inside the tenant callback.
 */
export async function withAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const familyId = await verifyAdmin();
  if (familyId === null) {
    throw new Error('Admin access required');
  }
  return runWithTenant(familyId, fn);
}

/**
 * withAdmin() for the admin actions that report the refusal to the owner in words
 * rather than throwing a 500 at them — the shape three /admin/* action files each
 * hand-rolled as `try { await requireAdmin() } catch { return { error: … } }`.
 * The message is unchanged from those call sites, full stop included.
 */
export async function withAdminOrError<T>(
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  const familyId = await verifyAdmin();
  if (familyId === null) {
    return { error: 'Admin access required.' };
  }
  return runWithTenant(familyId, fn);
}

// Denial messages for the soft member guards. Held as constants because each is
// used by both a guard and its wrapper, and the wording reaches users verbatim.
const NOT_SIGNED_IN = 'Please sign in.';
const NOT_A_MEMBER = 'You are not a member of this family.';
const VIEW_ONLY = 'You have view-only access.';
const OWNER_ONLY_DELETE = 'Only the family owner can delete things.';

/**
 * Shared by the soft member guards (editor/deleter) and their wrappers.
 * Establishes tenant context (once membership is confirmed) BEFORE the role
 * check, so callers that proceed always have a scoped query().
 */
async function verifyMember(
  action: Action,
  denied: string
): Promise<{ error: string } | { familyId: number }> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return { error: NOT_SIGNED_IN };
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership) return { error: NOT_A_MEMBER };
  enterTenant(session.familyId);
  if (!roleAllows(membership.role, action)) return { error: denied };
  return { familyId: session.familyId };
}

/**
 * Soft check for editor privileges — returns an error object instead of
 * throwing, so server actions can surface a friendly message to view-only users.
 *
 * PAGES (and any non-mutating caller) only. In a Server Action use withEditor():
 * a bare `await requireEditor()` leaves the following query() with no tenant.
 */
export async function requireEditor(): Promise<{ error: string } | null> {
  const verified = await verifyMember('edit', VIEW_ONLY);
  return 'error' in verified ? verified : null;
}

/**
 * requireEditor() for Server Actions. Returns the same `{ error }` objects, with
 * the same wording, when the caller may not edit — otherwise runs `fn` inside the
 * tenant callback and returns its result.
 */
export async function withEditor<T>(
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  const verified = await verifyMember('edit', VIEW_ONLY);
  if ('error' in verified) return verified;
  return runWithTenant(verified.familyId, fn);
}

/**
 * Soft check for DELETE privileges. Deleting people/events/simchas is destructive
 * and irreversible, so it's limited to the family OWNER.
 *
 * PAGES only. In a Server Action use withDeleter().
 */
export async function requireDeleter(): Promise<{ error: string } | null> {
  const verified = await verifyMember('delete', OWNER_ONLY_DELETE);
  return 'error' in verified ? verified : null;
}

/**
 * requireDeleter() for Server Actions — same messages, `fn` inside the tenant
 * callback.
 */
export async function withDeleter<T>(
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  const verified = await verifyMember('delete', OWNER_ONLY_DELETE);
  if ('error' in verified) return verified;
  return runWithTenant(verified.familyId, fn);
}

export async function getSessionInfo(): Promise<{
  signedIn: boolean;
  familyId: number | null;
  role: MembershipRole | null;
  personId: number | null;
}> {
  const session = await getSession();
  return {
    signedIn: !!session.userId,
    familyId: session.familyId ?? null,
    role: session.role ?? null,
    personId: session.personId ?? null,
  };
}
