import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/oauth';
import { upsertUser, getMembershipsForUser } from '@/lib/users';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/client-ip';
import { logError } from '@/lib/log';
import { absoluteUrl } from '@/lib/absolute-url';

/** Redirect back to the login page with a generic OAuth error (never leaks details). */
function oauthError(request: NextRequest): NextResponse {
  return NextResponse.redirect(absoluteUrl('/login?error=oauth', request));
}

/** Redirect to login flagged as rate-limited — a humane, non-technical bounce. */
function rateLimitedError(request: NextRequest): NextResponse {
  return NextResponse.redirect(absoluteUrl('/login?error=rate', request));
}

/**
 * Step 2 of the Google sign-in flow: Google redirects the browser here with a
 * `code` + the `state` we sent. We verify `state` against the session (CSRF),
 * exchange the code for the user's identity, upsert the user, and establish the
 * session. Users with a membership land on their calendar (or their saved
 * post-login path); users with none go to onboarding.
 */
export async function GET(request: NextRequest) {
  // Protect the token-exchange endpoint from being hammered (10/min per IP).
  const limit = rateLimit(`oauth-callback:${clientIp(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitedError(request);
  }

  const session = await getSession();

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  // Consume the one-time CSRF token whether or not it matches — it must never be
  // replayable.
  const expectedState = session.oauthState;
  delete session.oauthState;

  if (!code || !state || !expectedState || state !== expectedState) {
    await session.save();
    return oauthError(request);
  }

  let identity;
  try {
    identity = await exchangeCode(code);
  } catch (err) {
    // Log the real reason server-side (Railway captures it) but never leak
    // Google/token-exchange error details to the client.
    logError('oauth.callback.exchange', err);
    await session.save();
    return oauthError(request);
  }

  const { id } = await upsertUser(identity);
  session.userId = id;
  session.userEmail = identity.email;

  const memberships = await getMembershipsForUser(id);
  if (memberships.length === 0) {
    // A brand-new user who signed in FROM an invite link has no family yet — the
    // /join page is exactly how they get one. Honor that pending redirect instead
    // of bouncing them to onboarding (which would drop the invite). Any other
    // zero-membership user goes to onboarding to create their first family.
    const pending = session.postLoginRedirect;
    if (pending && pending.startsWith('/join/')) {
      delete session.postLoginRedirect;
      await session.save();
      return NextResponse.redirect(absoluteUrl(pending, request));
    }
    delete session.postLoginRedirect;
    await session.save();
    return NextResponse.redirect(absoluteUrl('/onboarding', request));
  }

  // Most-recent membership first (getMembershipsForUser orders by created_at DESC).
  const active = memberships[0];
  session.familyId = active.family_id;
  session.role = active.role;
  session.personId = active.member_person_id ?? undefined;
  // Defensive: signing in re-establishes a single active home; exit any combined view.
  delete session.viewFamilyIds;

  const dest = session.postLoginRedirect ?? '/';
  delete session.postLoginRedirect;

  await session.save();
  return NextResponse.redirect(absoluteUrl(dest, request));
}
