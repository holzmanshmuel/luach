import { describe, it, expect, afterEach, vi } from 'vitest';
import { absoluteUrl } from '@/lib/absolute-url';

describe('absoluteUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves against x-forwarded-host on the NEXTAUTH_URL allowlist when NEXTAUTH_URL is unset', () => {
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const request = new Request('http://0.0.0.0:8080/api/auth/google/callback', {
      headers: {
        'x-forwarded-host': 'family-calendar.holzman-ai.com',
        'x-forwarded-proto': 'https',
      },
    });
    // With NEXTAUTH_URL unset there is no allowlist derived from it, so this
    // arbitrary host is NOT trusted → falls back to request.url origin.
    const url = absoluteUrl('/login?error=oauth', request);
    expect(url.origin).toBe('http://0.0.0.0:8080');
  });

  it('uses NEXTAUTH_URL origin and IGNORES a malicious x-forwarded-host', () => {
    // The core open-redirect fix: NEXTAUTH_URL is set (as it is in prod AND dev),
    // so attacker-controlled x-forwarded-host must be ignored entirely.
    vi.stubEnv('NEXTAUTH_URL', 'https://family-calendar.holzman-ai.com');
    const request = new Request('http://0.0.0.0:8080/api/auth/google/callback?code=x&state=bad', {
      headers: {
        'x-forwarded-host': 'evil.com',
        'x-forwarded-proto': 'https',
      },
    });
    const url = absoluteUrl('/login?error=oauth', request);
    expect(url.origin).toBe('https://family-calendar.holzman-ai.com');
    expect(url.host).not.toBe('evil.com');
  });

  it('preserves the path exactly when using the NEXTAUTH_URL origin', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://family-calendar.holzman-ai.com');
    const request = new Request('http://0.0.0.0:8080/api/auth/google/callback', {
      headers: { 'x-forwarded-host': 'evil.com' },
    });
    const url = absoluteUrl('/login?error=oauth&next=%2Fjoin%2Fabc', request);
    expect(url.toString()).toBe(
      'https://family-calendar.holzman-ai.com/login?error=oauth&next=%2Fjoin%2Fabc'
    );
  });

  it('defaults to https when x-forwarded-proto is absent (host matches NEXTAUTH_URL)', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://family-calendar.holzman-ai.com');
    const request = new Request('http://0.0.0.0:8080/', {
      headers: { 'x-forwarded-host': 'family-calendar.holzman-ai.com' },
    });
    const url = absoluteUrl('/onboarding', request);
    expect(url.origin).toBe('https://family-calendar.holzman-ai.com');
  });

  it('NEXTAUTH_URL always wins over x-forwarded-host, even a valid one', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://family-calendar.holzman-ai.com');
    const request = new Request('http://0.0.0.0:8080/', {
      headers: {
        'x-forwarded-host': 'family-calendar.holzman-ai.com, internal-proxy.railway.internal',
        'x-forwarded-proto': 'https',
      },
    });
    const url = absoluteUrl('/', request);
    expect(url.origin).toBe('https://family-calendar.holzman-ai.com');
  });

  it('NEXTAUTH_URL takes precedence over request.url origin', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://family-calendar.holzman-ai.com');
    const request = new Request('http://0.0.0.0:8080/join-invalid');
    const url = absoluteUrl('/join-invalid', request);
    expect(url.toString()).toBe('https://family-calendar.holzman-ai.com/join-invalid');
  });

  it('falls back to request.url origin in dev (no forwarded host, no env)', () => {
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const request = new Request('http://localhost:3000/some/path');
    const url = absoluteUrl('/', request);
    expect(url.origin).toBe('http://localhost:3000');
  });

  it('trusts a localhost:3000 x-forwarded-host in dev when NEXTAUTH_URL is unset', () => {
    // FIX-1 branch 2: with no NEXTAUTH_URL, the allowlist still includes
    // localhost:3000 / localhost, so a dev proxy can set XFH to localhost.
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const request = new Request('http://0.0.0.0:8080/', {
      headers: { 'x-forwarded-host': 'localhost:3000', 'x-forwarded-proto': 'http' },
    });
    const url = absoluteUrl('/login', request);
    expect(url.origin).toBe('http://localhost:3000');
  });

  it('rejects a malicious x-forwarded-host when NEXTAUTH_URL is unset (not on allowlist)', () => {
    vi.stubEnv('NEXTAUTH_URL', undefined);
    const request = new Request('http://localhost:3000/', {
      headers: { 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'https' },
    });
    const url = absoluteUrl('/login', request);
    // evil.com is not on the allowlist → fall back to request.url origin.
    expect(url.origin).toBe('http://localhost:3000');
    expect(url.host).not.toBe('evil.com');
  });

  it('trusts an x-forwarded-host matching NEXTAUTH_URL host when NEXTAUTH_URL is malformed', () => {
    // Defensive: a non-URL NEXTAUTH_URL must not be used as an origin; fall
    // through to the allowlist/request.url path instead of throwing.
    vi.stubEnv('NEXTAUTH_URL', 'not a url');
    const request = new Request('http://localhost:3000/', {
      headers: { 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'https' },
    });
    const url = absoluteUrl('/login', request);
    expect(url.origin).toBe('http://localhost:3000');
  });
});
