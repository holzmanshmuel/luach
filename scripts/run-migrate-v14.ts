import { Pool } from 'pg';
import fs from 'fs';

// SSL for managed/remote Postgres; local dev Postgres has none.
//
// NOTE: point DATABASE_URL at the schema OWNER for this one (ALTER TABLE), not at
// the app's `app_user` role — app_user has data privileges only. The app itself
// must keep connecting as app_user.
const url = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const sql = fs.readFileSync(new URL('./migrate-v14.sql', import.meta.url), 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('V14 migration complete (per-family branch lists).');
}

main().catch(err => { console.error(err); process.exit(1); });
