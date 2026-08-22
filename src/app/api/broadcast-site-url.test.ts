import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { systemQuery, query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { gregorianToHebrew } from '@/lib/hebrew';
import { GET as digestGET } from '@/app/api/digest/week/route';
import { GET as yahrzeitGET } from '@/app/api/reminders/yahrzeit/route';

/**
 * Both n8n broadcast feeds embed a link to "this deployment" in text that is
 * delivered to a phone somewhere else. They used to fall back to the
 * maintainer's own hosted instance when NEXTAUTH_URL was unset, so a
 * self-hoster who forgot the variable would quietly message their family a link
 * into somebody ELSE'S calendar. These tests pin the replacement contract:
 *
 *   no NEXTAUTH_URL, no broadcast — a 500 naming the variable, never a guess.
 *
 * Requires DATABASE_URL pointing at staging Postgres with migration v13 applied,
 * connected as app_user so RLS is genuinely enforced.
 */

const TOKEN = 'zz-broadcast-site-url-test-token';
const SITE = 'https://calendar.example.test';
const PERSON = 'ZzSiteurlperson';

let familyId: number;

/** today + `lead` days, at local midnight — the day the reminder targets. */
function dayAhead(lead: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + lead);
  return d;
}

beforeAll(async () => {
  const [fam] = await systemQuery<{ id: number }>(
    "INSERT INTO family_calendar.families (name) VALUES ('Site URL Family') RETURNING id"
  );
  familyId = fam.id;

  // A yahrzeit landing exactly on tomorrow, so the default lead=1 reminder has
  // real content and the message body (not just the empty-state) is exercised.
  const hebrew = gregorianToHebrew(dayAhead(1));
  await runWithTenant(familyId, async () => {
    const [person] = await query<{ id: number }>(
      'INSERT INTO family_calendar.family_members (name) VALUES ($1) RETURNING id',
      [PERSON]
    );
    await query(
      `INSERT INTO family_calendar.events
         (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year)
       VALUES ($1, 'yahrtzeit', $2, $3, $4)`,
      [person.id, hebrew.day, hebrew.month, hebrew.year - 10]
    );
  });
});

afterAll(async () => {
  // family_members/events FK-cascade off families (migrate-v10).
  await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [familyId]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function feedRequest(path: string): NextRequest {
  return new NextRequest(
    `https://internal.invalid${path}${path.includes('?') ? '&' : '?'}family=${familyId}`,
    { headers: { authorization: `Bearer ${TOKEN}` } }
  );
}

const ROUTES: [string, string, (r: NextRequest) => Promise<Response>][] = [
  ['weekly digest', '/api/digest/week', digestGET],
  ['yahrzeit reminder', '/api/reminders/yahrzeit', yahrzeitGET],
];

describe.each(ROUTES)('%s — NEXTAUTH_URL is required, never defaulted', (_label, path, GET) => {
  it('500s naming NEXTAUTH_URL when the variable is unset', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const res = await GET(feedRequest(path));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('NEXTAUTH_URL');
  });

  it('500s on a blank/whitespace NEXTAUTH_URL too', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', '   ');
    const res = await GET(feedRequest(path));
    expect(res.status).toBe(500);
  });

  it('still 401s an unauthorized caller — a config gap is not reportable anonymously', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const res = await GET(
      new NextRequest(`https://internal.invalid${path}?family=${familyId}&token=wrong`)
    );
    expect(res.status).toBe(401);
  });

  it('uses the configured URL — with trailing slashes trimmed — when it is set', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', `${SITE}//`);
    const res = await GET(feedRequest(path));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain(SITE);
    expect(body.message).not.toContain(`${SITE}//`);
  });

  it('never emits a hardcoded hosted-instance domain', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', SITE);
    const res = await GET(feedRequest(path));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('holzman-ai.com');
  });
});

describe('yahrzeit reminder — the seeded yahrzeit actually reaches the message', () => {
  it('lists the person, so the URL assertions ran against real content', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', SITE);
    const res = await yahrzeitGET(feedRequest('/api/reminders/yahrzeit'));
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    expect(body.message).toContain(PERSON);
    expect(body.message).toContain(SITE);
  });
});
