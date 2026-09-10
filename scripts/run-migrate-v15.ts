import { Pool } from 'pg';
import fs from 'fs';

// SSL for managed/remote Postgres; local dev Postgres has none.
//
// NOTE: point DATABASE_URL at the schema OWNER for this one (CREATE FUNCTION …
// SECURITY DEFINER must be owned by the role that owns the tables), not at the
// app's `app_user` role — app_user has data privileges only. The app itself must
// keep connecting as app_user.
const url = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const sql = fs.readFileSync(new URL('./migrate-v15.sql', import.meta.url), 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('V15 migration complete (peek_invite: read-only invite lookup).');
}

main().catch(err => { console.error(err); process.exit(1); });
