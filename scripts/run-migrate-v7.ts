import { Pool } from 'pg';
import fs from 'fs';

// SSL for managed/remote Postgres; local dev Postgres has none.
const url = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const sql = fs.readFileSync(new URL('./migrate-v7.sql', import.meta.url), 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('V7 migration complete (gatherings.kind).');
}

main().catch(err => { console.error(err); process.exit(1); });
