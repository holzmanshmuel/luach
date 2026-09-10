import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

/**
 * Guard contract for the daily digest feed. Every case here is answered BEFORE
 * the route touches Postgres, so this file needs no database — the message
 * content is covered by the pure-function tests in `lib/digest-daily.test.ts`.
 *
 * The order matters and is asserted: an anonymous caller must get 401 even when
 * the server is misconfigured, so a missing NEXTAUTH_URL is not reportable to
 * strangers.
 */

const TOKEN = 'zz-daily-digest-test-token';
const SITE = 'https://calendar.example.test';

afterEach(() => vi.unstubAllEnvs());

const req = (qs = '', headers: Record<string, string> = {}) =>
  new NextRequest(`https://internal.invalid/api/digest/daily${qs}`, { headers });

describe('GET /api/digest/daily — auth and guards', () => {
  it('500s when N8N_TOKEN is not configured', async () => {
    vi.stubEnv('N8N_TOKEN', undefined);
    const res = await GET(req('?family=1', { authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('N8N_TOKEN');
  });

  it('401s a missing, wrong or malformed token', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', SITE);
    for (const r of [
      req('?family=1'),
      req('?family=1&token=wrong'),
      req('?family=1', { authorization: 'Bearer nope' }),
      req('?family=1', { authorization: `Basic ${TOKEN}` }),
    ]) {
      expect((await GET(r)).status).toBe(401);
    }
  });

  it('accepts the token as a bearer header or a query param', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', SITE);
    // Past the token check, so the next guard (family) is what answers.
    expect((await GET(req('', { authorization: `Bearer ${TOKEN}` }))).status).toBe(400);
    expect((await GET(req(`?token=${TOKEN}`))).status).toBe(400);
  });

  it('500s naming NEXTAUTH_URL rather than broadcasting a guessed link', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const res = await GET(req('?family=1', { authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('NEXTAUTH_URL');
  });

  it('still 401s when NEXTAUTH_URL is missing — config is not reportable anonymously', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    expect((await GET(req('?family=1&token=wrong'))).status).toBe(401);
  });

  it('400s without a usable family id — never falls back to "all families"', async () => {
    vi.stubEnv('N8N_TOKEN', TOKEN);
    vi.stubEnv('NEXTAUTH_URL', SITE);
    for (const qs of ['', '?family=', '?family=abc', '?family=0', '?family=-3', '?family=1.5']) {
      const res = await GET(req(qs, { authorization: `Bearer ${TOKEN}` }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('family');
    }
  });
});
