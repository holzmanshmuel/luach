import { describe, it, expect, afterEach } from 'vitest';
import { googleAuthUrl, parseIdToken } from '@/lib/oauth';

const REDIRECT = 'http://localhost:3000/api/auth/google/callback';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

/** Build an (unsigned) id_token = base64url(header).base64url(payload).sig */
function makeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature-not-verified`;
}

describe('googleAuthUrl', () => {
  const prevClientId = process.env.GOOGLE_CLIENT_ID;
  const prevRedirect = process.env.OAUTH_REDIRECT_URI;

  afterEach(() => {
    // Restore whatever the environment had before the test.
    if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevClientId;
    if (prevRedirect === undefined) delete process.env.OAUTH_REDIRECT_URI;
    else process.env.OAUTH_REDIRECT_URI = prevRedirect;
  });

  it('builds a correctly-encoded Google authorization URL', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_REDIRECT_URI = REDIRECT;

    const raw = googleAuthUrl('xyz');
    expect(raw.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);

    const url = new URL(raw);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('parseIdToken', () => {
  const prevClientId = process.env.GOOGLE_CLIENT_ID;

  afterEach(() => {
    if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevClientId;
  });

  it('returns the identity for a valid id_token (aud matches, email verified)', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({
      aud: CLIENT_ID,
      email_verified: true,
      sub: '1234567890',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/p.png',
    });
    expect(parseIdToken(token)).toEqual({
      sub: '1234567890',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/p.png',
    });
  });

  it('accepts email_verified as the string "true"', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({
      aud: CLIENT_ID,
      email_verified: 'true',
      sub: 's',
      email: 'user@example.com',
    });
    expect(parseIdToken(token).email).toBe('user@example.com');
  });

  it('throws when aud does not match GOOGLE_CLIENT_ID', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({
      aud: 'someone-elses-client-id',
      email_verified: true,
      sub: 's',
      email: 'user@example.com',
    });
    expect(() => parseIdToken(token)).toThrow(/audience/i);
  });

  it('throws when email_verified is false', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({
      aud: CLIENT_ID,
      email_verified: false,
      sub: 's',
      email: 'user@example.com',
    });
    expect(() => parseIdToken(token)).toThrow(/not verified/i);
  });

  it('throws when email_verified is missing', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({ aud: CLIENT_ID, sub: 's', email: 'user@example.com' });
    expect(() => parseIdToken(token)).toThrow(/not verified/i);
  });

  it('throws when sub is missing', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({ aud: CLIENT_ID, email_verified: true, email: 'user@example.com' });
    expect(() => parseIdToken(token)).toThrow(/missing sub or email/i);
  });

  it('throws when email is missing', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    const token = makeIdToken({ aud: CLIENT_ID, email_verified: true, sub: 's' });
    expect(() => parseIdToken(token)).toThrow(/missing sub or email/i);
  });
});
