import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { redeemInvite } from '@/lib/tokens';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/client-ip';
import { logError, tokenPrefix } from '@/lib/log';
import { absoluteUrl } from '@/lib/absolute-url';

/**
 * Invite JOIN flow (Task 3.2) — the viral loop, as a ROUTE HANDLER.
 *
 * This used to be a Server Component page, but redemption MUST write the session
 * cookie (flip the active family), and Next forbids cookie mutation during RSC
 * render ("Cookies can only be modified in a Server Action or Route Handler").
 * A GET route handler is the sanctioned place to both write the session and
 * redirect — the same proven pattern the Google OAuth callback uses.
 *
 * A relative opens /join/<token>:
 *  • Signed OUT → bounce into Google sign-in with ?next pointing back here
 *    (sanitizeNext allows same-origin paths). After sign-in the OAuth callback
 *    returns them here — now signed in — and even a brand-new zero-family user is
 *    sent back to this link rather than to onboarding.
 *  • Signed IN → redeemInvite() joins them to the invite's family (the ONE
 *    legitimate cross-tenant op, via a SECURITY DEFINER function). We flip the
 *    session's active family/role to the joined family, clear any stale personId,
 *    save, and redirect to /?joined=1 — they land IN the joined family's calendar,
 *    which is itself the confirmation.
 *  • Invalid / expired / revoked → redirect to /join-invalid (a friendly bilingual
 *    static page), never leaking error detail.
 *
 * The proxy allowlists /join/ so a signed-out visitor reaches this handler instead
 * of being bounced to /login (which would drop the invite token).
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/join/[token]'>
) {
  // Brute-force guard on invite tokens (10/min per IP). Tokens are 256-bit, so
  // this is belt-and-suspenders — but it also caps abusive redemption traffic.
  const limit = rateLimit(`join:${clientIp(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return new NextResponse('Too many requests. Please wait a minute.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSec ?? 60) },
    });
  }

  const { token } = await ctx.params;
  const session = await getSession();

  // Signed out → send to Google sign-in, returning here afterwards.
  if (!session.userId) {
    return NextResponse.redirect(
      absoluteUrl(`/api/auth/google?next=/join/${encodeURIComponent(token)}`, request)
    );
  }

  const result = await redeemInvite(token, session.userId);

  if ('error' in result) {
    // Log the failure REASON server-side (Railway captures it) for debugging,
    // but keep the client redirect opaque — never leak why it failed (expired /
    // revoked / bad token / already used). Only a short token PREFIX is logged.
    logError('join.redeem.failed', result.error, {
      userId: session.userId,
      tokenPrefix: tokenPrefix(token),
    });
    return NextResponse.redirect(absoluteUrl('/join-invalid', request));
  }

  // Success — make the joined family the session's active tenant, then land the
  // new member in that family's calendar.
  session.familyId = result.familyId;
  session.role = result.role;
  // A joiner is not linked to a specific family_member; clear any stale deep-link.
  delete session.personId;
  // Joining a family makes it the single active home; exit any combined view.
  delete session.viewFamilyIds;
  await session.save();

  return NextResponse.redirect(absoluteUrl('/?joined=1', request));
}
