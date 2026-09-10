import { describe, it, expect } from 'vitest';
import type { SessionData } from '@/lib/auth';
import { enterFamily } from '@/lib/session-transitions';

/**
 * enterFamily is what every "you are now in THIS family" path runs: first-run
 * onboarding, "start another calendar" (/families/new), and invite redemption. The
 * two deletes are the part worth pinning — both are silent when they go missing, and
 * one of them is a live bug the moment a second family becomes creatable.
 */
describe('enterFamily', () => {
  it('makes the family active and records the role', () => {
    const session = {} as SessionData;
    enterFamily(session, 42, 'owner');
    expect(session.familyId).toBe(42);
    expect(session.role).toBe('owner');
  });

  it('clears the COMBINED view — the /families/new bug', () => {
    // A user sitting in a merged view of families 1 and 2 creates family 3. If
    // viewFamilyIds survives, / renders the merge of 1 and 2, family 3 is filtered
    // out, and the button they just pressed looks like it did nothing whatsoever.
    const session = { userId: 7, familyId: 1, role: 'editor', viewFamilyIds: [1, 2] } as SessionData;
    enterFamily(session, 3, 'owner');
    expect(session.viewFamilyIds).toBeUndefined();
    expect(session.familyId).toBe(3);
  });

  it('clears the per-family person mapping', () => {
    // personId says which family_member this session is acting as. It is meaningless
    // in a different family, so carrying it over would point at a stranger's row.
    const session = { userId: 7, familyId: 1, personId: 99, role: 'viewer' } as SessionData;
    enterFamily(session, 2, 'editor');
    expect(session.personId).toBeUndefined();
    expect(session.role).toBe('editor');
  });

  it('leaves the signed-in identity alone', () => {
    // Moving between families is not a re-authentication.
    const session = {
      userId: 7,
      userEmail: 'someone@example.com',
      familyId: 1,
      role: 'owner',
    } as SessionData;
    enterFamily(session, 2, 'viewer');
    expect(session.userId).toBe(7);
    expect(session.userEmail).toBe('someone@example.com');
  });
});
