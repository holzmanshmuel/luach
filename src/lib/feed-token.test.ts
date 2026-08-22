import { describe, it, expect } from 'vitest';
import { systemQuery } from '@/lib/db';
import { familyIdForFeedToken, feedTokenForFamily } from '@/lib/feed-token';

// Requires DATABASE_URL pointing at staging Postgres with migration v13 applied
// (families.feed_token — backfilled, DEFAULTed, NOT NULL, UNIQUE). Run as
// app_user, the role the app really connects as, so the table-level grants that
// must cover the new column are the ones exercised here.
//
// `families` is one of the non-RLS tenancy tables, so every read/write below is a
// systemQuery (same discipline as users.ts / tokens.test.ts).

/** Make a throwaway family and return its id. NOTE: feed_token is never supplied
 *  — the column DEFAULT is what must mint it (no app-code change on create). */
async function makeFamily(name: string): Promise<number> {
  const [row] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.families (name) VALUES ($1) RETURNING id',
    [name]
  );
  return row.id;
}

async function dropFamily(id: number): Promise<void> {
  await systemQuery('DELETE FROM family_calendar.families WHERE id = $1', [id]);
}

async function readToken(id: number): Promise<string> {
  const [row] = await systemQuery<{ feed_token: string }>(
    'SELECT feed_token FROM family_calendar.families WHERE id = $1',
    [id]
  );
  return row.feed_token;
}

describe('families.feed_token column', () => {
  it('is minted automatically for a brand-new family (no app-code change on create)', async () => {
    const id = await makeFamily('Feed Token Default Family');
    try {
      const token = await readToken(id);
      // 24 random bytes hex-encoded = 48 lowercase hex chars (192 bits of entropy).
      expect(token).toMatch(/^[0-9a-f]{48}$/);
    } finally {
      await dropFamily(id);
    }
  });

  it('gives every family a DIFFERENT token', async () => {
    const a = await makeFamily('Feed Token Distinct A');
    const b = await makeFamily('Feed Token Distinct B');
    try {
      expect(await readToken(a)).not.toBe(await readToken(b));
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('is backfilled on every pre-existing family (no NULLs anywhere)', async () => {
    const rows = await systemQuery<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM family_calendar.families WHERE feed_token IS NULL'
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('refuses a duplicate token (UNIQUE constraint)', async () => {
    const a = await makeFamily('Feed Token Unique A');
    const b = await makeFamily('Feed Token Unique B');
    try {
      const tokenA = await readToken(a);
      await expect(
        systemQuery('UPDATE family_calendar.families SET feed_token = $1 WHERE id = $2', [
          tokenA,
          b,
        ])
      ).rejects.toThrow();
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('refuses a NULL token (NOT NULL constraint)', async () => {
    const a = await makeFamily('Feed Token NotNull A');
    try {
      await expect(
        systemQuery('UPDATE family_calendar.families SET feed_token = NULL WHERE id = $1', [a])
      ).rejects.toThrow();
    } finally {
      await dropFamily(a);
    }
  });
});

describe('familyIdForFeedToken', () => {
  it('resolves each family from its own token', async () => {
    const a = await makeFamily('Feed Resolve A');
    const b = await makeFamily('Feed Resolve B');
    try {
      expect(await familyIdForFeedToken(await readToken(a))).toBe(a);
      expect(await familyIdForFeedToken(await readToken(b))).toBe(b);
    } finally {
      await dropFamily(a);
      await dropFamily(b);
    }
  });

  it('returns null for an unknown token', async () => {
    expect(await familyIdForFeedToken('not-a-real-feed-token')).toBeNull();
  });

  it('returns null for an empty/missing token without hitting the DB', async () => {
    expect(await familyIdForFeedToken('')).toBeNull();
  });
});

describe('feedTokenForFamily', () => {
  it("returns that family's token", async () => {
    const a = await makeFamily('Feed Lookup A');
    try {
      const token = await feedTokenForFamily(a);
      expect(token).toBe(await readToken(a));
    } finally {
      await dropFamily(a);
    }
  });

  it('returns null for a family that does not exist', async () => {
    expect(await feedTokenForFamily(2147483000)).toBeNull();
  });

  it('round-trips: feedTokenForFamily → familyIdForFeedToken', async () => {
    const a = await makeFamily('Feed RoundTrip A');
    try {
      const token = await feedTokenForFamily(a);
      expect(token).not.toBeNull();
      expect(await familyIdForFeedToken(token!)).toBe(a);
    } finally {
      await dropFamily(a);
    }
  });
});
