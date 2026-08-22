import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { systemQuery, query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { GET } from '@/app/api/calendar.ics/route';

/**
 * The iCal feed is the app's only unauthenticated-by-cookie surface (calendar
 * apps can't send cookies — see the /api/calendar.ics allowlist in src/proxy.ts),
 * so the token in the URL is the WHOLE authorization decision. These tests pin
 * the multi-tenant contract:
 *
 *   the token IDENTIFIES its family — there is no family selector to tamper with,
 *   and no master key that opens every family.
 *
 * Requires DATABASE_URL pointing at staging Postgres with migration v13 applied,
 * connected as app_user so RLS is genuinely enforced during feed generation.
 */

const A_PERSON = 'ZzAlphaperson';
const B_PERSON = 'ZzBetaperson';

let familyA: number;
let familyB: number;
let tokenA: string;
let tokenB: string;

async function makeFamilyWithEvent(name: string, personName: string) {
  const [row] = await systemQuery<{ id: number; feed_token: string }>(
    'INSERT INTO family_calendar.families (name) VALUES ($1) RETURNING id, feed_token',
    [name]
  );
  await runWithTenant(row.id, async () => {
    const [person] = await query<{ id: number }>(
      'INSERT INTO family_calendar.family_members (name) VALUES ($1) RETURNING id',
      [personName]
    );
    await query(
      `INSERT INTO family_calendar.events (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year)
       VALUES ($1, 'birthday', 15, 'Sivan', 5750)`,
      [person.id]
    );
  });
  return { id: row.id, token: row.feed_token };
}

beforeAll(async () => {
  const a = await makeFamilyWithEvent('Feed Route Family A', A_PERSON);
  const b = await makeFamilyWithEvent('Feed Route Family B', B_PERSON);
  familyA = a.id;
  tokenA = a.token;
  familyB = b.id;
  tokenB = b.token;
});

afterAll(async () => {
  // family_members/events FK-cascade off families.
  await systemQuery('DELETE FROM family_calendar.families WHERE id = ANY($1)', [
    [familyA, familyB],
  ]);
});

function feedRequest(qs: string): NextRequest {
  return new NextRequest(`https://family-calendar.example.com/api/calendar.ics${qs}`);
}

describe('GET /api/calendar.ics — per-family feed tokens', () => {
  it("serves ONLY the token's own family's events", async () => {
    const res = await GET(feedRequest(`?token=${encodeURIComponent(tokenA)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    const body = await res.text();
    expect(body).toContain(A_PERSON);
    expect(body).not.toContain(B_PERSON);
  });

  it("ignores a ?family= param pointing at ANOTHER family — the token decides", async () => {
    const res = await GET(
      feedRequest(`?token=${encodeURIComponent(tokenA)}&family=${familyB}`)
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    // The cross-tenant read the old shared-token design allowed. Must not happen.
    expect(body).toContain(A_PERSON);
    expect(body).not.toContain(B_PERSON);
  });

  it('is symmetric: family B\'s token + ?family=<A> still yields only B', async () => {
    const res = await GET(
      feedRequest(`?token=${encodeURIComponent(tokenB)}&family=${familyA}`)
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(B_PERSON);
    expect(body).not.toContain(A_PERSON);
  });

  it('ignores a nonsense ?family= param rather than erroring', async () => {
    const res = await GET(feedRequest(`?token=${encodeURIComponent(tokenA)}&family=not-a-number`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(A_PERSON);
  });

  it('401s on a wrong token', async () => {
    const res = await GET(feedRequest('?token=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
    expect(res.status).toBe(401);
  });

  it('401s when the token is missing entirely', async () => {
    const res = await GET(feedRequest(''));
    expect(res.status).toBe(401);
  });

  it('401s on an empty token', async () => {
    const res = await GET(feedRequest('?token='));
    expect(res.status).toBe(401);
  });

  it('401s on a token-shaped value that belongs to no family, even with a family param', async () => {
    const res = await GET(feedRequest(`?token=00000000000000000000000000000000000000000000000f&family=${familyA}`));
    expect(res.status).toBe(401);
  });

  it('401s for the retired shared master token — ICAL_TOKEN grants nothing now', async () => {
    vi.stubEnv('ICAL_TOKEN', 'legacy-master-token-value');
    try {
      const res = await GET(
        feedRequest(`?token=legacy-master-token-value&family=${familyA}`)
      );
      expect(res.status).toBe(401);
      // …and with no family param either.
      const res2 = await GET(feedRequest('?token=legacy-master-token-value'));
      expect(res2.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still serves the feed when ICAL_TOKEN is absent from the environment', async () => {
    // The old route 503'd when ICAL_TOKEN was unset. Per-family tokens make that
    // env var irrelevant, so an unset ICAL_TOKEN must not break the feed.
    vi.stubEnv('ICAL_TOKEN', undefined);
    try {
      const res = await GET(feedRequest(`?token=${encodeURIComponent(tokenA)}`));
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
