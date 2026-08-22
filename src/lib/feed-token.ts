import { systemQuery } from '@/lib/db';

/**
 * Per-family iCal feed tokens (migrate-v13).
 *
 * The calendar feed is the one surface calendar apps fetch WITHOUT a cookie, so
 * the token in the URL is the entire authorization decision. Each family has its
 * own high-entropy `families.feed_token`, which means the credential also names
 * the tenant: there is no `?family=` selector to tamper with, and no shared
 * master token whose leak would expose every family.
 *
 * `families` is one of the non-RLS tenancy tables, so both lookups are
 * systemQuery — they necessarily run BEFORE any tenant context exists (the
 * whole point is to decide which tenant to enter), exactly like getFamilyById()
 * for the invite /join page.
 *
 * On constant-time comparison: this is a plain indexed equality in Postgres, not
 * a timingSafeEqual. That's deliberate and matches how access_tokens are already
 * resolved (`WHERE token_hash = $1` in resolveToken). The token is 192 bits of
 * pgcrypto randomness, so there is nothing for a timing oracle to walk toward —
 * unlike the old design, where a single guessable-length shared secret was
 * compared in the app.
 */

/**
 * The family a feed token belongs to, or null when the token is empty or matches
 * no family. Callers MUST treat null as 401 — an unknown token is a failed
 * authentication, not a missing resource (a 404 would confirm which tokens are
 * real).
 */
export async function familyIdForFeedToken(token: string): Promise<number | null> {
  // Short-circuit the empty string so a missing ?token= never reaches the DB.
  if (!token) return null;
  const rows = await systemQuery<{ id: number }>(
    'SELECT id FROM family_calendar.families WHERE feed_token = $1',
    [token]
  );
  return rows[0]?.id ?? null;
}

/**
 * A family's feed token, or null when the family does not exist. Only ever
 * called for a family the caller has already proven the signed-in user is a live
 * member of — this hands out a secret.
 */
export async function feedTokenForFamily(familyId: number): Promise<string | null> {
  const rows = await systemQuery<{ feed_token: string }>(
    'SELECT feed_token FROM family_calendar.families WHERE id = $1',
    [familyId]
  );
  return rows[0]?.feed_token ?? null;
}
