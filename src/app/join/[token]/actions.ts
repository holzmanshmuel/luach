'use server';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { redeemInvite } from '@/lib/tokens';
import { getMembership } from '@/lib/users';
import { enterFamily } from '@/lib/session-transitions';
import { rateLimit } from '@/lib/ratelimit';
import { logError, tokenPrefix } from '@/lib/log';

/**
 * Redeem an invite link — the ONLY place a membership is created from a link.
 *
 * This is a server action, POSTed by the Join button on /join/<token>, because
 * redemption is a mutation and must not happen on a GET: the old route handler
 * joined on sight, which an in-app <Link> prefetch could have triggered silently
 * (the same class of bug documented on /api/logout). It is also the only place that
 * can legally write the session cookie — an RSC render cannot.
 */
export async function joinFamilyAction(token: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session.userId) {
    // Unreachable from the UI (the button only renders for a signed-in visitor),
    // but the action is a public endpoint and must fail closed.
    return { error: 'Please sign in.' };
  }

  // Per-USER cap, replacing the route handler's per-IP one. The token is 256-bit so
  // this is belt-and-braces, but it still caps abusive redemption traffic — and the
  // page's peek is capped separately, per IP. Both belong.
  const limit = rateLimit(`join-redeem:${session.userId}`, { limit: 10, windowMs: 60_000 });
  if (!limit.ok) {
    // Bilingual literal, matching createFamilyAction's cap message: an action's
    // error string has no `lang` in hand and both audiences read this page.
    return {
      error:
        'Too many attempts just now — please wait a minute and try again. · יותר מדי ניסיונות כרגע — המתינו דקה ונסו שוב.',
    };
  }

  const result = await redeemInvite(token, session.userId);

  if ('error' in result) {
    // Log the REASON server-side (Railway captures it) but keep the redirect opaque
    // — never leak expired vs revoked vs forged. Only a short token prefix is logged.
    logError('join.redeem.failed', result.error, {
      userId: session.userId,
      tokenPrefix: tokenPrefix(token),
    });
    redirect('/join-invalid');
  }

  // ── Trust the MEMBERSHIP, not the token ──
  // redeemInvite already re-reads the live membership and returns the role the user
  // actually holds; this second read is the belt to that braces, because the value
  // lands in the session cookie and proxy.ts gates /admin/* on it. Getting it from
  // the token instead is what locked owners out of their own admin pages when they
  // clicked their own invite link to check it.
  const live = await getMembership(session.userId, result.familyId);
  enterFamily(session, result.familyId, live?.role ?? result.role);
  await session.save();

  // ?joined=1 drives the one confirmation a new relative gets (JoinedBanner on /).
  // redirect() throws NEXT_REDIRECT, so it must be OUTSIDE any try/catch — nothing
  // above catches, so calling it at the top level here is correct.
  redirect('/?joined=1');
}
