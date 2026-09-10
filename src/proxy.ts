import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { SessionData, sessionOptions } from '@/lib/auth';

/**
 * The public host this deployment answers on, from its own configuration.
 *
 * Read from `NEXTAUTH_URL` — never from the incoming request, which is the whole
 * point: an attacker controls request headers, so deriving the "expected" host
 * from one would turn the check below into a no-op.
 */
const PUBLIC_HOST = (() => {
  const configured = process.env.NEXTAUTH_URL;
  if (!configured) return null;
  try {
    return new URL(configured).host || null;
  } catch {
    return null;
  }
})();

/**
 * Let Server Actions survive a reverse proxy.
 *
 * ── THE BUG THIS FIXES ──
 * Next compares a Server Action request's `Origin` header against the host it
 * believes it is serving (`x-forwarded-host`) and aborts on a mismatch, as a CSRF
 * defence. Behind the Cloudflare Worker in front of this app those two can never
 * agree: the browser sends the public domain, the Worker forwards Railway's
 * internal hostname. Next therefore rejected EVERY Server Action —
 * "Invalid Server Actions request" — which killed every edit in the app (adding an
 * event, editing a person, saving a phone number, correcting a date) while route
 * handlers, page rendering and sign-in all kept working. The site looked healthy;
 * only writing was dead.
 *
 * ⚠️ `next.config.ts`'s `serverActions.allowedOrigins` is the documented fix and it
 * does NOT work here: that value is baked in during `next build`, this image is
 * built from a Dockerfile, and the Dockerfile declares no build arg for
 * `NEXTAUTH_URL` — so at build time the list resolves EMPTY and the setting
 * silently does nothing. Doing it here instead makes it a runtime concern, which
 * is what it actually is.
 *
 * ── WHY THIS IS STILL SAFE ──
 * The forwarded host is replaced with the host this deployment is CONFIGURED to
 * serve, not with anything from the request. Next then compares the browser's
 * `Origin` against that fixed value, so the CSRF check is preserved in full: a
 * request from evil.example.test still mismatches and is still aborted.
 */
function passThrough(request: NextRequest): NextResponse {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!PUBLIC_HOST || forwardedHost === PUBLIC_HOST) {
    // Nothing to repair: either this deployment declares no public host, or the
    // proxy in front already forwards the right one.
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', PUBLIC_HOST);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the iCal feed (calendar apps can't send cookies). The route
  // authenticates itself with the per-family feed token in the URL, which also
  // selects the tenant — see src/app/api/calendar.ics/route.ts. NOTE: the
  // /api/subscribe routes that HAND OUT that token are deliberately NOT
  // allowlisted; they fall through to the cookie gate below (and re-check live
  // membership themselves).
  if (pathname.startsWith('/api/calendar.ics')) {
    return passThrough(request);
  }

  // Always allow the n8n feeds (they authenticate via N8N_TOKEN header/query)
  if (
    pathname.startsWith('/api/events/today') ||
    pathname.startsWith('/api/digest/') ||
    pathname.startsWith('/api/reminders/') ||
    pathname.startsWith('/api/families')
  ) {
    return passThrough(request);
  }

  // Always allow the login page and invite join links, and internal assets.
  // /join/ must be reachable while signed OUT — it redirects the visitor into
  // Google sign-in (with ?next back to itself) and, once signed in, redeems
  // the invite. The cookie gate below would otherwise bounce a signed-out
  // invitee to /login and lose the invite token. /join-invalid is the friendly
  // failure page /join/ redirects to — it must also render signed-out (a
  // signed-out visitor with a dead token gets bounced through sign-in and back,
  // and can land here still without an active family).
  // NOTE: /magic/ is no longer allowlisted — that route is now a tombstone
  // (retired at the multi-family cutover), so signed-out scans of legacy QR
  // cards fall through to the standard cookie gate below and get redirected
  // to /login like any other gated path.
  // /privacy is the public privacy policy — like /welcome it must render for
  // signed-out visitors (a policy nobody can read before signing in is useless).
  if (
    pathname === '/welcome' ||
    pathname === '/privacy' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/join/') ||
    pathname === '/join-invalid' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return passThrough(request);
  }

  // Always allow onboarding. A just-signed-in user with NO family has a userId but
  // no familyId, so the cookie gate below (which requires BOTH) would bounce them
  // to /login in a loop — the OAuth callback sends exactly these users here to
  // create their first family. The /onboarding page itself enforces userId
  // server-side (redirects signed-out visitors to /login).
  if (pathname === '/onboarding') {
    return passThrough(request);
  }

  // Always allow the Google OAuth entry + callback (they run BEFORE a session
  // exists — the whole point is to establish one — so the cookie gate below
  // would otherwise bounce them to /login in an infinite loop).
  if (
    pathname === '/api/auth/google' ||
    pathname === '/api/auth/google/callback'
  ) {
    return passThrough(request);
  }

  // Always allow sign-out. Signing out must work from a HALF-established session —
  // userId but no familyId — which is exactly what an invited relative has while
  // they sit on /join/<token> deciding whether the Google account they landed on is
  // the right one. The cookie gate below requires BOTH ids, so without this the
  // "use a different Google account" escape hatch on that page would be swallowed
  // and they could never get out of the wrong account. Destroying a session (or a
  // non-existent one) needs no authorization.
  if (pathname === '/api/logout') {
    return passThrough(request);
  }

  // Always allow the PWA manifest + icons (fetched unauthenticated by browsers/OS
  // when installing or building the home-screen icon).
  if (
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icons/') ||
    pathname === '/apple-touch-icon.png'
  ) {
    return passThrough(request);
  }

  // Always allow the service worker script + its offline fallback shell —
  // both must be reachable without a session (the SW itself has no
  // cookies, and /offline is what it serves when there's no network).
  if (pathname === '/sw.js' || pathname === '/offline') {
    return passThrough(request);
  }

  const response = passThrough(request);
  const session = await getIronSession<SessionData>(request, response, sessionOptions);

  // Coarse cookie-level gate only. Real authorization (live membership + role) is
  // enforced in the server-action guards (requireAuth/requireEditor/…), which
  // re-check against the DB — the proxy just keeps signed-out traffic off the app.
  if (!session.userId || !session.familyId) {
    // SIGNED IN but with no active family — they abandoned onboarding, or their only
    // membership was removed. Onboarding is where they need to be, and /login is a
    // dead end for them: they are already signed in, so it would sign them in again
    // and land them right back here. (/onboarding itself is allowlisted above, so
    // this cannot loop.) Without this, a family-less user bounced between /login and
    // /welcome with no way into the app at all.
    if (session.userId) {
      return NextResponse.redirect(new URL('/onboarding', request.url));
    }
    // A cold visitor to the root gets the public marketing front door (/welcome);
    // any deeper gated path still bounces to the lightweight /login page carrying
    // ?from= so the post-sign-in redirect lands them back where they were headed.
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/welcome', request.url));
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // /admin/* is owner-only. The cached role is a hint here; requireAdmin verifies
  // it live before any admin action runs.
  if (pathname.startsWith('/admin') && session.role !== 'owner') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export default proxy;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
