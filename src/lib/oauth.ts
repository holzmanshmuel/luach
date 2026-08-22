/**
 * Minimal, dependency-free Google OAuth 2.0 "authorization code" flow.
 *
 * Two helpers:
 *   - googleAuthUrl(state)  → the URL to redirect the user's browser to.
 *   - exchangeCode(code)    → server-to-server token exchange, returns the
 *                             identity claims from the id_token.
 *
 * Env vars (read at call time, not module load, so tests and missing-env
 * cases behave predictably):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Build the Google authorization URL the user is redirected to. `state` is an
 * opaque anti-CSRF token the caller generates and verifies on the callback.
 */
export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: requireEnv('OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/** Base64url-decode a JWT segment and JSON.parse it. */
function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length < 2) throw new Error('Malformed id_token: not a JWT');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Decode an id_token's payload and assert its identity claims.
 *
 * The id_token arrives directly from Google over TLS (server-to-server), so we
 * don't verify the signature — but we DO validate the claims as defense in
 * depth: the audience MUST be our own client_id (an id_token minted for another
 * app must never be accepted), and the email MUST be verified. Anything short of
 * that throws before an identity is returned.
 */
export function parseIdToken(idToken: string): GoogleIdentity {
  const payload = decodeJwtPayload(idToken);

  const expectedAud = requireEnv('GOOGLE_CLIENT_ID');
  if (payload.aud !== expectedAud) {
    throw new Error('id_token audience does not match GOOGLE_CLIENT_ID');
  }

  const emailVerified = payload.email_verified;
  if (emailVerified !== true && emailVerified !== 'true') {
    throw new Error('id_token email is not verified');
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email) {
    throw new Error('id_token payload missing sub or email');
  }

  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const picture = typeof payload.picture === 'string' ? payload.picture : undefined;

  return { sub, email, name, picture };
}

/**
 * Exchange an authorization code for the user's identity. This is a
 * server-to-server POST to Google's token endpoint; the id_token comes
 * directly from Google over TLS (not from the client), so decoding its payload
 * WITHOUT verifying the signature is acceptable here.
 */
export async function exchangeCode(code: string): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: requireEnv('OAUTH_REDIRECT_URI'),
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('Token response missing id_token');

  return parseIdToken(data.id_token);
}
