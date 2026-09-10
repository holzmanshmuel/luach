import { describe, it, expect } from 'vitest';
import { extractInviteToken } from '@/lib/invite-link';
import { generateToken } from '@/lib/tokens';

/**
 * The paste box on /onboarding takes whatever a relative managed to copy. These
 * cases are the shapes that actually turn up: a full URL, a bare path, a bare token,
 * a link with a WhatsApp-appended query string, a trailing slash, and a paste that is
 * really a sentence.
 */
describe('extractInviteToken', () => {
  it('accepts a real generated token, in every shape it can arrive in', () => {
    // The genuine article: randomBytes(32).toString('base64url'), so the test cannot
    // drift from the token format the app actually mints.
    const token = generateToken();
    expect(extractInviteToken(token)).toBe(token);
    expect(extractInviteToken(`/join/${token}`)).toBe(token);
    expect(extractInviteToken(`https://family-calendar.example.com/join/${token}`)).toBe(token);
    expect(extractInviteToken(`  https://example.com/join/${token}  `)).toBe(token);
    expect(extractInviteToken(`https://example.com/join/${token}/`)).toBe(token);
    expect(extractInviteToken(`https://example.com/join/${token}?utm_source=whatsapp`)).toBe(token);
    expect(extractInviteToken(`https://example.com/join/${token}#anchor`)).toBe(token);
  });

  it('never looks at the host — a link from another deployment still yields its token', () => {
    // Deliberate: that link simply will not resolve on THIS deployment, which is the
    // right outcome and better than guessing about origins.
    const token = generateToken();
    expect(extractInviteToken(`http://localhost:3000/join/${token}`)).toBe(token);
  });

  it('rejects anything that is not token-shaped', () => {
    expect(extractInviteToken('')).toBeNull();
    expect(extractInviteToken('   ')).toBeNull();
    expect(extractInviteToken(null)).toBeNull();
    expect(extractInviteToken(undefined)).toBeNull();
    // A half-copied link: the path is there but the token is gone.
    expect(extractInviteToken('https://example.com/join/')).toBeNull();
    expect(extractInviteToken('https://example.com/join')).toBeNull();
    // Too short to be a 43-char base64url token.
    expect(extractInviteToken('abc123')).toBeNull();
    // Right length, wrong alphabet (a sentence with spaces, or padding characters).
    expect(extractInviteToken('please let me into the family calendar')).toBeNull();
    expect(extractInviteToken('a'.repeat(20) + '=')).toBeNull();
    // Pathologically long paste — capped so it can never become a giant redirect.
    expect(extractInviteToken('a'.repeat(500))).toBeNull();
  });
});
