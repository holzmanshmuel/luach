import type { SessionData } from '@/lib/auth';
import type { MembershipRole } from '@/lib/users';

/**
 * Make `familyId` the session's single active home.
 *
 * Used by every path that lands a user in a family they were not just in: first-run
 * onboarding, "start another calendar" (/families/new), and invite redemption. Kept
 * as one pure function over the session object so the three cannot drift, and so
 * the two easy-to-forget deletes below are testable without a cookie.
 *
 * `personId` is a per-family deep-link (which family_member this session is acting
 * as), so it is meaningless in a different family and must not survive the move.
 *
 * `viewFamilyIds` is load-bearing: a user sitting in the COMBINED view who creates
 * or joins a family would otherwise land on a merged calendar that filters the new
 * family out — the button looks like it did nothing at all. This is the same
 * discipline /api/family/switch already applies when flipping families.
 */
export function enterFamily(
  session: SessionData,
  familyId: number,
  role: MembershipRole
): void {
  session.familyId = familyId;
  session.role = role;
  delete session.personId;
  delete session.viewFamilyIds;
}
