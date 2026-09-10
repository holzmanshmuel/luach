/**
 * Bring a database up to the current schema, from empty or from any older
 * version. This is the one command a self-hoster needs:
 *
 *   DATABASE_URL="postgres://<owner>@host:5432/family_calendar" npm run migrate
 *
 * Point it at the schema OWNER, not the app's `app_user` role. The migrations
 * CREATE TABLE / ALTER TABLE / CREATE EXTENSION, which app_user deliberately
 * cannot do. The app itself must keep connecting as app_user, because row-level
 * security is what isolates one family's data from another's — and Postgres
 * silently skips RLS for superusers and for roles with BYPASSRLS.
 *
 * Runs scripts/seed.sql (the base schema) followed by every scripts/migrate-v*.sql
 * in numeric order, each in its own transaction. All of them are written to be
 * idempotent, so re-running on an up-to-date database is a no-op.
 */
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('ERROR: DATABASE_URL is required.');
  console.error('Usage: DATABASE_URL="postgres://<owner>@host/db" npm run migrate');
  process.exit(1);
}

// SSL for managed/remote Postgres; local dev Postgres has none.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * seed.sql first, then migrate-v2.sql … migrate-vN.sql in numeric order.
 *
 * Discovered by glob, not listed: adding a `migrate-v<N>.sql` file is all it takes
 * to register a new migration, and there is no list here to forget to update.
 */
function migrationFiles(): string[] {
  const versioned = fs
    .readdirSync(scriptsDir)
    .filter(f => /^migrate-v\d+\.sql$/.test(f))
    .sort((a, b) => {
      const n = (s: string) => Number(s.match(/\d+/)![0]);
      return n(a) - n(b);
    });
  return ['seed.sql', ...versioned];
}

async function main() {
  const files = migrationFiles();
  console.log(`Applying ${files.length} migration(s)…\n`);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(scriptsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log(`
Schema is up to date.

Next: create the restricted role the app connects as, then grant it the data
privileges (run as the owner, once):

  CREATE ROLE app_user LOGIN PASSWORD '<a strong password>';
  GRANT USAGE ON SCHEMA family_calendar TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA family_calendar TO app_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA family_calendar TO app_user;
  GRANT EXECUTE ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) TO app_user;
  GRANT EXECUTE ON FUNCTION family_calendar.peek_invite(TEXT) TO app_user;

Then set the app's DATABASE_URL to that role — NOT to the owner, and never to a
superuser: row-level security is skipped for superusers, which would let one
family read another's calendar.
`);
}

main().catch(err => { console.error(err); process.exit(1); });
