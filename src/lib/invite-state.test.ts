import { describe, it, expect } from 'vitest';
import { resolveInviteState } from '@/lib/invite-state';

/**
 * /join/<token> has four visible states, and which one a relative sees is decided
 * entirely by the branch ORDER in resolveInviteState. Pure table tests, so the order
 * is pinned without a request, a session or a database.
 *
 * Two of these encode judgement calls that are easy to "simplify" back into bugs:
 * an existing member is never told to go ask for a new link, and an unknown token
 * never reveals anything at all.
 */
describe('resolveInviteState', () => {
  it('state 1 — a live link and nobody signed in asks them to sign in', () => {
    expect(resolveInviteState({ status: 'live', isSignedIn: false, isMember: false })).toBe(
      'sign_in'
    );
  });

  it('state 2 — a live link, signed in, not a member yet, asks them to confirm', () => {
    expect(resolveInviteState({ status: 'live', isSignedIn: true, isMember: false })).toBe(
      'confirm'
    );
  });

  it('state 3 — an existing member is told they are already in', () => {
    expect(resolveInviteState({ status: 'live', isSignedIn: true, isMember: true })).toBe(
      'already_member'
    );
  });

  it('state 4 — a dead link reports WHY it is dead, expired and revoked separately', () => {
    expect(resolveInviteState({ status: 'expired', isSignedIn: false, isMember: false })).toBe(
      'expired'
    );
    expect(resolveInviteState({ status: 'revoked', isSignedIn: false, isMember: false })).toBe(
      'revoked'
    );
    // Same for a signed-in non-member — the reason is about the LINK, not the reader.
    expect(resolveInviteState({ status: 'expired', isSignedIn: true, isMember: false })).toBe(
      'expired'
    );
    expect(resolveInviteState({ status: 'revoked', isSignedIn: true, isMember: false })).toBe(
      'revoked'
    );
  });

  it('an unknown token is invalid no matter who is asking', () => {
    // Nothing to name and no reason worth leaking — /join-invalid, always. This is
    // also why an unknown token cannot reach the "already a member" branch: there is
    // no family to be a member of.
    for (const isSignedIn of [true, false]) {
      for (const isMember of [true, false]) {
        expect(resolveInviteState({ status: 'unknown', isSignedIn, isMember })).toBe('invalid');
      }
    }
  });

  it('membership BEATS an expired or revoked link', () => {
    // An owner clicking their own link months later has nothing to fix, so telling
    // them to "ask whoever sent it for a new one" would be wrong advice — and the
    // already-in branch is the one that writes nothing to the session, which is what
    // makes the owner lock-out bug structurally impossible on this page.
    expect(resolveInviteState({ status: 'expired', isSignedIn: true, isMember: true })).toBe(
      'already_member'
    );
    expect(resolveInviteState({ status: 'revoked', isSignedIn: true, isMember: true })).toBe(
      'already_member'
    );
  });

  it('ignores a stale isMember when nobody is signed in', () => {
    // Membership is unknowable without a user; a caller that passes true anyway must
    // not accidentally get the signed-in screen.
    expect(resolveInviteState({ status: 'live', isSignedIn: false, isMember: true })).toBe(
      'sign_in'
    );
  });
});
