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
  const sql = fs.readFileSync(new URL('./migrate-v5.sql', import.meta.url), 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('V5 migration complete (maiden_name, maiden_name_he).');
}

main().catch(err => { console.error(err); process.exit(1); });
