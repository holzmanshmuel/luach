import type { InviteStatus } from '@/lib/tokens';

/**
 * Which of the invite landing page's states to render.
 *
 *   invalid        → redirect to /join-invalid (unknown token; reason stays opaque)
 *   already_member → "you are already in the <family> calendar", nothing to do
 *   expired        → "this link has expired", names the family
 *   revoked        → "this link was turned off", names the family
 *   sign_in        → "you're invited to the <family> calendar" + Continue with Google
 *   confirm        → "join the <family> calendar?" + the Join button (the ONLY
 *                    state that offers the redemption action)
 */
export type InviteViewState =
  | 'invalid'
  | 'already_member'
  | 'expired'
  | 'revoked'
  | 'sign_in'
  | 'confirm';

/**
 * Pure state machine for /join/<token>. Extracted from the page so the branch
 * ORDER — the part that actually decides what a relative sees — is testable
 * without a request, a session or a database.
 *
 * The ordering is deliberate:
 *
 *  1. An unknown token reveals nothing, ever. It cannot even name a family,
 *     because there is no family to name.
 *  2. An existing member is told they are already in, even when the link they
 *     clicked has since expired or been revoked — they have nothing to fix, and
 *     "ask for a new link" would be wrong advice. This branch is also why the
 *     owner lock-out bug cannot come back here: an owner clicking their own
 *     invite link lands on a page that writes nothing to the session.
 *  3. Only then does a dead link report why it is dead.
 *  4. A live link asks a signed-out visitor to sign in, and a signed-in
 *     non-member to confirm.
 *
 * `isMember` is only meaningful when signed in; callers pass false otherwise.
 */
export function resolveInviteState(input: {
  status: InviteStatus;
  isSignedIn: boolean;
  isMember: boolean;
}): InviteViewState {
  if (input.status === 'unknown') return 'invalid';
  if (input.isSignedIn && input.isMember) return 'already_member';
  if (input.status === 'expired') return 'expired';
  if (input.status === 'revoked') return 'revoked';
  return input.isSignedIn ? 'confirm' : 'sign_in';
}
