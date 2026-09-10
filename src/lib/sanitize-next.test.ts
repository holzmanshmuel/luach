import { describe, it, expect } from 'vitest';
import { sanitizeNext } from '@/lib/sanitize-next';

describe('sanitizeNext', () => {
  it('accepts a simple same-origin path', () => {
    expect(sanitizeNext('/x')).toBe('/x');
  });

  it('accepts a same-origin path with a query string', () => {
    expect(sanitizeNext('/x?y=1')).toBe('/x?y=1');
  });

  it('rejects an absolute cross-origin URL', () => {
    expect(sanitizeNext('https://evil.com')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNext('//evil.com')).toBeNull();
  });

  it('rejects a backslash protocol-relative trick', () => {
    expect(sanitizeNext('/\\evil.com')).toBeNull();
  });

  it('rejects a bare path with no leading slash', () => {
    expect(sanitizeNext('evil.com')).toBeNull();
  });

  it('returns null for empty, null, or undefined input', () => {
    expect(sanitizeNext('')).toBeNull();
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
  });
});

/**
 * The open redirect that shipped: the URL parser strips ASCII tab, CR and LF from
 * anywhere in a URL before resolving it, so a value can pass a startsWith('//')
 * check and still resolve cross-origin once those characters are removed.
 *
 * Confirmed live in production before the fix:
 *   /api/logout?next=%2F%09%2Fevil.com  ->  Location: https://evil.com/
 *
 * The same sanitizer gates /api/auth/google?next=, the OAuth callback's post-login
 * redirect and /login?from=, so this could carry a person through a real Google
 * sign-in and then bounce them to an attacker's page.
 */
describe('characters the URL parser strips', () => {
  const HOSTILE = ['\t', '\r', '\n'];

  it('rejects a protocol-relative target hidden behind a stripped character', () => {
    for (const c of HOSTILE) {
      expect(sanitizeNext(`/${c}/evil.com`)).toBeNull();
      expect(sanitizeNext(`/${c}/evil.com/path`)).toBeNull();
    }
  });

  it('rejects them wherever they sit, not just after the first slash', () => {
    for (const c of HOSTILE) {
      expect(sanitizeNext(`/${c}${c}/evil.com`)).toBeNull();
      expect(sanitizeNext(`${c}//evil.com`)).toBeNull();
    }
  });

  it('rejects a backslash variant hidden the same way', () => {
    expect(sanitizeNext('/\t\\evil.com')).toBeNull();
    expect(sanitizeNext('/\r\\/evil.com')).toBeNull();
  });

  it('rejects the remaining control characters', () => {
    expect(sanitizeNext('/\x00/evil.com')).toBeNull();
    expect(sanitizeNext('/\x0b/evil.com')).toBeNull();
    expect(sanitizeNext('/\x1f/evil.com')).toBeNull();
    expect(sanitizeNext('/\x7f/evil.com')).toBeNull();
  });

  it('allows a space, which the parser encodes rather than strips', () => {
    // Not a bypass: it resolves to the same-origin path /%20/evil.com, so there is
    // no reason to reject a value a person could legitimately have in a path.
    expect(sanitizeNext('/ /evil.com')).toBe('/%20/evil.com');
  });

  it('still accepts the ordinary paths the app actually redirects to', () => {
    expect(sanitizeNext('/')).toBe('/');
    expect(sanitizeNext('/tree')).toBe('/tree');
    expect(sanitizeNext('/admin/dates')).toBe('/admin/dates');
    expect(sanitizeNext('/join/abc123')).toBe('/join/abc123');
    expect(sanitizeNext('/?month=9&year=2026')).toBe('/?month=9&year=2026');
  });

  it('never returns something that resolves off-origin', () => {
    // The property that actually matters, asserted over a spread of attempts.
    const attempts = [
      '//evil.com', '/\\evil.com', '/\t/evil.com', '/\r\n/evil.com',
      'https://evil.com', 'javascript:alert(1)', '/\t\t//evil.com',
      '\\\\evil.com', '/tree', '/', '/a/b?c=d#e',
    ];
    for (const attempt of attempts) {
      const safe = sanitizeNext(attempt);
      if (safe === null) continue;
      expect(new URL(safe, 'https://calendar.example.test').origin)
        .toBe('https://calendar.example.test');
    }
  });
});
