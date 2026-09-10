import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { proxy } from '@/proxy';
import { sessionOptions, type SessionData } from '@/lib/auth';

/**
 * The cookie gate. Pure — no database: the proxy only ever reads the sealed cookie
 * (real authorization happens later, in the server-action guards, against the DB).
 *
 * The case that matters here is the HALF-established session — `userId` but no
 * `familyId`. It is not an edge case: it is every user who abandoned onboarding, and
 * every brand-new relative sitting on /join/<token> after signing in. The gate
 * requires BOTH ids, so those users used to be bounced to /login, which signs them in
 * again and lands them right back with no family — or to /welcome from the root,
 * which is a marketing page. Neither is a way into the app.
 */
beforeAll(() => {
  // sessionOptions.password is a lazy getter that throws below 32 chars.
  process.env.SESSION_PASSWORD ??= 'test-session-password-at-least-32-chars-long';
});

/**
 * Seal a cookie the same way the app does — by round-tripping a real iron-session —
 * so the test can never drift from the app's own cookie format.
 */
async function sessionCookie(data: Partial<SessionData>): Promise<string> {
  const request = new NextRequest('http://localhost:3000/');
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);
  Object.assign(session, data);
  await session.save();
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('iron-session did not set a cookie');
  return setCookie.split(';')[0];
}

async function visit(pathname: string, cookie?: string) {
  const request = new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const response = await proxy(request);
  const location = response.headers.get('location');
  return { status: response.status, location: location ? new URL(location).pathname : null, search: location ? new URL(location).search : null };
}

describe('proxy cookie gate — signed in with no family', () => {
  it('sends an abandoned-onboarding user to /onboarding, NOT /login', async () => {
    const cookie = await sessionCookie({ userId: 1 });
    const { location } = await visit('/tree', cookie);
    expect(location).toBe('/onboarding');
  });

  it('sends them to /onboarding from the root too, not the marketing page', async () => {
    // /welcome is for people who have never signed in. This user has.
    const cookie = await sessionCookie({ userId: 1 });
    const { location } = await visit('/', cookie);
    expect(location).toBe('/onboarding');
  });

  it('does not loop: /onboarding itself is allowlisted', async () => {
    const cookie = await sessionCookie({ userId: 1 });
    const { location } = await visit('/onboarding', cookie);
    expect(location).toBeNull();
  });

  it('lets them reach /families/new only by way of /onboarding', async () => {
    // A family-less user who guesses the URL has no family to add another to, so the
    // gate sends them to first-run onboarding — which is the correct page.
    const cookie = await sessionCookie({ userId: 1 });
    const { location } = await visit('/families/new', cookie);
    expect(location).toBe('/onboarding');
  });

  it('cannot ping-pong with /onboarding', async () => {
    // The loop this pairs with: the proxy sends every family-less signed-in user to
    // /onboarding, and /onboarding sends anyone WITH a membership to '/'. If the page
    // redirected on membership alone, a session holding memberships but no familyId
    // would bounce /→/onboarding→/ forever. The proxy half is pinned here (it must
    // send them to /onboarding, not loop through /login); the page half breaks the
    // loop by rendering a re-enter-your-family panel instead of redirecting.
    const cookie = await sessionCookie({ userId: 1 });
    expect((await visit('/', cookie)).location).toBe('/onboarding');
    expect((await visit('/onboarding', cookie)).location).toBeNull();
  });

  it('lets them SIGN OUT — the invite page\'s wrong-Google-account escape hatch', async () => {
    // A relative who signed in as the wrong person while joining has userId but no
    // familyId. If the gate swallowed /api/logout they could never get out of that
    // account, and "use a different Google account" on /join/<token> would be a lie.
    const cookie = await sessionCookie({ userId: 1 });
    const { location } = await visit('/api/logout', cookie);
    expect(location).toBeNull();
  });
});

describe('proxy cookie gate — unchanged behaviour', () => {
  it('a cold visitor to the root still gets the marketing page', async () => {
    const { location } = await visit('/');
    expect(location).toBe('/welcome');
  });

  it('a signed-out deep link still bounces to /login carrying ?from=', async () => {
    const { location, search } = await visit('/timeline');
    expect(location).toBe('/login');
    expect(search).toBe('?from=%2Ftimeline');
  });

  it('/join/<token> stays reachable while signed out — the invite link must not be lost', async () => {
    const { location } = await visit('/join/some-invite-token');
    expect(location).toBeNull();
  });

  it('/join-invalid stays reachable while signed out', async () => {
    const { location } = await visit('/join-invalid');
    expect(location).toBeNull();
  });

  it('a fully established session passes through', async () => {
    const cookie = await sessionCookie({ userId: 1, familyId: 2, role: 'editor' });
    const { location } = await visit('/tree', cookie);
    expect(location).toBeNull();
  });

  it('/admin/* stays owner-only', async () => {
    const cookie = await sessionCookie({ userId: 1, familyId: 2, role: 'editor' });
    expect((await visit('/admin/access', cookie)).location).toBe('/');
    const ownerCookie = await sessionCookie({ userId: 1, familyId: 2, role: 'owner' });
    expect((await visit('/admin/access', ownerCookie)).location).toBeNull();
  });

  it('the iCal feed and the n8n routes stay unauthenticated', async () => {
    // Calendar apps send no cookies, and the 08:00 cron authenticates with N8N_TOKEN.
    // Removing either allowlist entry fails silently — no error, just missing
    // yahrzeit reminders and dead subscriptions.
    expect((await visit('/api/calendar.ics')).location).toBeNull();
    expect((await visit('/api/events/today')).location).toBeNull();
    expect((await visit('/api/digest/week')).location).toBeNull();
    expect((await visit('/api/reminders/yahrzeit')).location).toBeNull();
    expect((await visit('/api/families')).location).toBeNull();
  });
});
