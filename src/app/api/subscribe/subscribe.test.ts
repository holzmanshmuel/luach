import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { SessionData } from '@/lib/auth';

// The subscribe routes are the ONLY place a family's feed token is handed out, so
// they must (a) require a live signed-in member and (b) hand out the ACTIVE
// family's token — never a master key, never another family's, and never the
// combined-view set. getSession() is the iron-session read the sibling
// authenticated routes use (/api/family/switch, /api/family/view); it needs a
// real request-scoped cookie store, so it is the one thing mocked here. The
// membership re-check and the token lookup run against the real staging DB.
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

import { getSession } from '@/lib/auth';
import { systemQuery } from '@/lib/db';
import { upsertUser } from '@/lib/users';
import { GET as subscribeGET } from '@/app/api/subscribe/route';
import { GET as infoGET } from '@/app/api/subscribe/info/route';

const mockedGetSession = vi.mocked(getSession);

const ORIGIN = 'https://family-calendar.example.com';

let userId: number;
let strangerId: number;
let familyA: number;
let familyB: number;
let tokenA: string;
let tokenB: string;

function setSession(data: SessionData) {
  // Only the fields the routes read matter; iron-session's save/destroy are not
  // exercised by these read-only routes.
  mockedGetSession.mockResolvedValue(data as Awaited<ReturnType<typeof getSession>>);
}

async function makeFamily(name: string) {
  const [row] = await systemQuery<{ id: number; feed_token: string }>(
    'INSERT INTO family_calendar.families (name) VALUES ($1) RETURNING id, feed_token',
    [name]
  );
  return row;
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  userId = (await upsertUser({ sub: `test-subscribe-${stamp}`, email: `sub-${stamp}@example.com` })).id;
  strangerId = (await upsertUser({
    sub: `test-subscribe-stranger-${stamp}`,
    email: `stranger-${stamp}@example.com`,
  })).id;

  const a = await makeFamily('Subscribe Family A');
  const b = await makeFamily('Subscribe Family B');
  familyA = a.id;
  tokenA = a.feed_token;
  familyB = b.id;
  tokenB = b.feed_token;

  await systemQuery(
    `INSERT INTO family_calendar.memberships (user_id, family_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')`,
    [userId, familyA, familyB]
  );
});

afterAll(async () => {
  await systemQuery('DELETE FROM family_calendar.memberships WHERE user_id = ANY($1)', [
    [userId, strangerId],
  ]);
  await systemQuery('DELETE FROM family_calendar.users WHERE id = ANY($1)', [
    [userId, strangerId],
  ]);
  await systemQuery('DELETE FROM family_calendar.families WHERE id = ANY($1)', [
    [familyA, familyB],
  ]);
});

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockedGetSession.mockReset();
});

function req(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

describe('GET /api/subscribe', () => {
  it("redirects to the ACTIVE family's own feed token", async () => {
    setSession({ userId, familyId: familyA });
    const res = await subscribeGET(req('/api/subscribe'));
    expect(res.status).toBe(307);
    const location = res.headers.get('Location')!;
    expect(location).toBe(
      `webcal://family-calendar.example.com/api/calendar.ics?token=${encodeURIComponent(tokenA)}`
    );
    // The family selector is gone — the token carries the tenant.
    expect(location).not.toContain('family=');
  });

  it('hands a different family a different token', async () => {
    setSession({ userId, familyId: familyB });
    const res = await subscribeGET(req('/api/subscribe'));
    const location = res.headers.get('Location')!;
    expect(location).toContain(encodeURIComponent(tokenB));
    expect(location).not.toContain(encodeURIComponent(tokenA));
  });

  it('uses the ACTIVE family, not the combined-view set', async () => {
    setSession({ userId, familyId: familyA, viewFamilyIds: [familyA, familyB] });
    const res = await subscribeGET(req('/api/subscribe'));
    const location = res.headers.get('Location')!;
    expect(location).toContain(encodeURIComponent(tokenA));
    expect(location).not.toContain(encodeURIComponent(tokenB));
  });

  it('401s with no session at all', async () => {
    setSession({});
    const res = await subscribeGET(req('/api/subscribe'));
    expect(res.status).toBe(401);
  });

  it('401s for a signed-in user with no active family', async () => {
    setSession({ userId });
    const res = await subscribeGET(req('/api/subscribe'));
    expect(res.status).toBe(401);
  });

  it('401s when the session names a family the user is not a live member of', async () => {
    setSession({ userId: strangerId, familyId: familyA });
    const res = await subscribeGET(req('/api/subscribe'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/subscribe/info', () => {
  it("returns the ACTIVE family's https + webcal URLs", async () => {
    setSession({ userId, familyId: familyA });
    const res = await infoGET(req('/api/subscribe/info'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { httpsUrl: string; webcalUrl: string };
    expect(body.httpsUrl).toBe(
      `${ORIGIN}/api/calendar.ics?token=${encodeURIComponent(tokenA)}`
    );
    expect(body.webcalUrl).toBe(
      `webcal://family-calendar.example.com/api/calendar.ics?token=${encodeURIComponent(tokenA)}`
    );
    expect(body.httpsUrl).not.toContain('family=');
  });

  it('uses the ACTIVE family, not the combined-view set', async () => {
    setSession({ userId, familyId: familyB, viewFamilyIds: [familyA, familyB] });
    const res = await infoGET(req('/api/subscribe/info'));
    const body = (await res.json()) as { httpsUrl: string };
    expect(body.httpsUrl).toContain(encodeURIComponent(tokenB));
    expect(body.httpsUrl).not.toContain(encodeURIComponent(tokenA));
  });

  it('401s with no session', async () => {
    setSession({});
    const res = await infoGET(req('/api/subscribe/info'));
    expect(res.status).toBe(401);
  });

  it('401s when the session names a family the user is not a live member of', async () => {
    setSession({ userId: strangerId, familyId: familyB });
    const res = await infoGET(req('/api/subscribe/info'));
    expect(res.status).toBe(401);
  });
});
