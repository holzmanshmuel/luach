'use server';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createFamilyWithOwner } from '@/lib/users';
import { rateLimit } from '@/lib/ratelimit';
import { logError } from '@/lib/log';

const MAX_NAME_LEN = 80;

/** Abuse cap: a single user may create at most this many families per day. */
const MAX_FAMILIES_PER_DAY = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Bilingual friendly message for the daily family-creation cap. */
const RATE_LIMIT_MSG =
  "You've created several families today — please try again tomorrow. · יצרתם כמה משפחות היום — נסו שוב מחר.";

/**
 * Onboarding: the signed-in user names a brand-new family and becomes its OWNER.
 * Creates the family + owner membership atomically (createFamilyWithOwner), makes
 * it the session's active family, then sends them to their (empty) calendar.
 *
 * Does NOT use tenant-scoped query() — the user has no family yet, so all writes
 * go through systemQuery-backed helpers on the non-RLS tables.
 */
export async function createFamilyAction(data: {
  name: string;
  name_he?: string;
}): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session.userId) {
    return { error: 'Please sign in.' };
  }

  // Abuse cap: at most MAX_FAMILIES_PER_DAY families per user per rolling day.
  // Per-user (not per-IP) so it can't be evaded by rotating IPs. Checked BEFORE
  // validation so a caller can't probe the limit's state via error messages.
  const limit = rateLimit(`create-family:${session.userId}`, {
    limit: MAX_FAMILIES_PER_DAY,
    windowMs: ONE_DAY_MS,
  });
  if (!limit.ok) {
    return { error: RATE_LIMIT_MSG };
  }

  const name = (data.name ?? '').trim();
  if (!name) {
    return { error: 'Please enter a family name.' };
  }
  if (name.length > MAX_NAME_LEN) {
    return { error: `Family name must be ${MAX_NAME_LEN} characters or fewer.` };
  }

  const nameHe = (data.name_he ?? '').trim();
  if (nameHe.length > MAX_NAME_LEN) {
    return { error: `Hebrew name must be ${MAX_NAME_LEN} characters or fewer.` };
  }

  let familyId: number;
  try {
    // Validation passed but the insert can still fail (DB down, constraint, RLS).
    ({ familyId } = await createFamilyWithOwner(session.userId, name, nameHe || null));
  } catch (err) {
    logError('onboarding.createFamily.insert', err, { userId: session.userId });
    return {
      error:
        "Something went wrong creating your family — please try again. · משהו השתבש ביצירת המשפחה — נסו שוב.",
    };
  }

  session.familyId = familyId;
  session.role = 'owner';
  session.personId = undefined;
  await session.save();

  // redirect() throws NEXT_REDIRECT, so it must be OUTSIDE any try/catch (Next 16
  // docs). Nothing above catches, so calling it here at the top level is correct.
  redirect('/');
}
