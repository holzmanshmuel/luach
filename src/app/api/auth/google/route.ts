import { randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { googleAuthUrl } from '@/lib/oauth';
import { sanitizeNext } from '@/lib/sanitize-next';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/client-ip';
import { absoluteUrl } from '@/lib/absolute-url';

/**
 * Step 1 of the Google sign-in flow: mint an anti-CSRF `state`, remember it (plus
 * an optional post-login destination) in the session, then bounce the browser to
 * Google's consent screen. The callback route verifies `state` on the way back.
 */
export async function GET(request: NextRequest) {
  // Cap how fast a single IP can spin up sign-in flows (10/min) — matches the
  // callback route's guard and limits state-minting/consent-redirect churn.
  const limit = rateLimit(`oauth-start:${clientIp(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.redirect(absoluteUrl('/login?error=rate', request));
  }

  const session = await getSession();

  const state = randomBytes(32).toString('base64url');
  session.oauthState = state;

  // Optional same-origin return path. sanitizeNext rejects anything that isn't a
  // local path (absolute/protocol-relative URLs) so this can't become an open
  // redirect. Clear any stale value when none is provided.
  const next = sanitizeNext(request.nextUrl.searchParams.get('next'));
  if (next) session.postLoginRedirect = next;
  else delete session.postLoginRedirect;

  await session.save();

  return NextResponse.redirect(googleAuthUrl(state));
}
