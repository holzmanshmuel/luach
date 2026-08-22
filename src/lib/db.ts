import { Pool, types } from 'pg';
import { getFamilyId } from '@/lib/tenant';
import { logError } from '@/lib/log';

// Return DATE columns as plain "YYYY-MM-DD" strings instead of Date objects.
// Without this, pg applies the local timezone offset and creates a Date whose
// UTC value is one day off, which breaks the "append T12:00:00Z" parsing.
types.setTypeParser(1082, (val: string) => val);

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (global._pgPool) return global._pgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
  });

  // Cache in dev to survive hot reloads
  if (process.env.NODE_ENV !== 'production') {
    global._pgPool = pool;
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const familyId = getFamilyId();
  if (familyId == null) {
    throw new Error('No tenant context: query() called without an active family.');
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_family', $1, true)", [String(familyId)]);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result.rows as T[];
  } catch (e) {
    await client.query('ROLLBACK');
    // Log then rethrow — surface the DB failure to callers, but leave a record.
    logError('db.query', e);
    throw e;
  } finally {
    client.release();
  }
}

/** Runs OUTSIDE tenant scope — only for the non-RLS tables (families, users, memberships). */
export async function systemQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/**
 * Like withTransaction, but OUTSIDE tenant scope — for multi-step mutations on the
 * non-RLS tables (families, users, memberships) where no family exists yet, e.g.
 * onboarding (create a family + its first owner membership atomically). Never sets
 * app.current_family, so it must not touch tenant (RLS) tables.
 */
export async function withSystemTransaction<T>(
  fn: (run: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows as R[];
    const result = await fn(run);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    logError('db.withSystemTransaction', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Run several statements on a single connection inside a transaction. On any
 * error the whole batch rolls back, so a multi-step mutation (e.g. replacing a
 * person's relationship rows via DELETE-then-INSERT) can't be left half-applied.
 */
export async function withTransaction<T>(
  fn: (run: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const familyId = getFamilyId();
    if (familyId == null) throw new Error('No tenant context: withTransaction() called without an active family.');
    await client.query("SELECT set_config('app.current_family', $1, true)", [String(familyId)]);
    const run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows as R[];
    const result = await fn(run);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    logError('db.withTransaction', e);
    throw e;
  } finally {
    client.release();
  }
}
