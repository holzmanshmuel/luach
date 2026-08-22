import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { enterTenant } from '@/lib/tenant';
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
export async function establishTenant(): Promise<{
  familyId: number;
  role: MembershipRole;
  personId: number | null;
} | null> {
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

/**
 * Throws unless the session has a signed-in user, an active family, and a live
 * membership in it. Verifies the membership against the DB (never trusts the
 * cookie's cached role), then establishes tenant context so downstream query()
 * calls are scoped to this family. Implemented on top of establishTenant() so
 * the membership-check + tenant-entry logic lives in exactly one place.
 */
export async function requireAuth(): Promise<void> {
  const tenant = await establishTenant();
  if (!tenant) {
    throw new Error('Unauthorized');
  }
}

/**
 * Throws unless the signed-in user is the OWNER of the active family (verified
 * live). Establishes tenant context on success. Replaces the old password-admin.
 */
export async function requireAdmin(): Promise<void> {
  const session = await getSession();
  if (!session.userId || !session.familyId) {
    throw new Error('Admin access required');
  }
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership || membership.role !== 'owner') {
    throw new Error('Admin access required');
  }
  enterTenant(session.familyId);
}

/**
 * Soft check for editor privileges — returns an error object instead of
 * throwing, so server actions can surface a friendly message to view-only users.
 * Establishes tenant context (once membership is confirmed) BEFORE the role
 * check, so callers that proceed always have a scoped query().
 */
export async function requireEditor(): Promise<{ error: string } | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return { error: 'Please sign in.' };
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership) return { error: 'You are not a member of this family.' };
  enterTenant(session.familyId);
  if (!roleAllows(membership.role, 'edit')) return { error: 'You have view-only access.' };
  return null;
}

/**
 * Soft check for DELETE privileges. Deleting people/events/simchas is destructive
 * and irreversible, so it's limited to the family OWNER. Establishes tenant
 * context once membership is confirmed, before the role check.
 */
export async function requireDeleter(): Promise<{ error: string } | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return { error: 'Please sign in.' };
  const membership = await getMembership(session.userId, session.familyId);
  if (!membership) return { error: 'You are not a member of this family.' };
  enterTenant(session.familyId);
  if (!roleAllows(membership.role, 'delete')) {
    return { error: 'Only the family owner can delete things.' };
  }
  return null;
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
