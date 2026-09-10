'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { createFamilyWithOwner } from '@/lib/users';
import { enterFamily } from '@/lib/session-transitions';
import { extractInviteToken } from '@/lib/invite-link';
import { rateLimit } from '@/lib/ratelimit';
import { logError } from '@/lib/log';
import { getT, type Lang } from '@/lib/translations';

const MAX_NAME_LEN = 80;

/** Abuse cap: a single user may create at most this many families per day. */
const MAX_FAMILIES_PER_DAY = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Bilingual friendly message for the daily family-creation cap. */
const RATE_LIMIT_MSG =
  "You've created several families today — please try again tomorrow. · יצרתם כמה משפחות היום — נסו שוב מחר.";

/**
 * The signed-in user names a brand-new family and becomes its OWNER. Creates the
 * family + owner membership atomically (createFamilyWithOwner), makes it the
 * session's active family, then sends them to their (empty) calendar.
 *
 * Serves BOTH first-run onboarding and /families/new ("start another calendar") — it
 * never checked the membership count, only /onboarding's page guard did — so its
 * 5-families-per-day cap is the abuse guard on both.
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

  // Also clears viewFamilyIds — see enterFamily. Without that, a user sitting in the
  // COMBINED view who uses /families/new lands on a merged calendar that filters the
  // family they just created out, and the button looks like it did nothing at all.
  enterFamily(session, familyId, 'owner');
  await session.save();

  // redirect() throws NEXT_REDIRECT, so it must be OUTSIDE any try/catch (Next 16
  // docs). Nothing above catches, so calling it here at the top level is correct.
  redirect('/');
}

/**
 * Take a PASTED invite link (or a bare token) and send the pasting user to it.
 *
 * The onboarding page is where a relative who was told "sign up at the site" ends up
 * — and before this, the only thing they could do there was create a second, empty
 * family. This turns the link they were actually sent into a way in.
 *
 * Redirects to /join/<token>, which then does all the real work (naming the family,
 * checking the token, asking them to confirm). Deliberately does NOT look at the
 * pasted URL's host: a link from a different deployment simply will not resolve
 * here, which is the correct outcome rather than something to guess about.
 */
export async function openInviteLinkAction(raw: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session.userId) {
    return { error: 'Please sign in.' };
  }

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);

  // Per-user cap: this endpoint resolves nothing itself, but it should not become a
  // free way to fan requests at /join/<token>'s own limiter.
  const limit = rateLimit(`open-invite:${session.userId}`, { limit: 20, windowMs: 60_000 });
  if (!limit.ok) {
    return { error: t('login.rate_limited') };
  }

  const token = extractInviteToken(raw);
  if (!token) {
    return { error: t('onboarding.invited_paste_error') };
  }

  // Outside any try/catch — redirect() throws NEXT_REDIRECT.
  redirect(`/join/${encodeURIComponent(token)}`);
}
