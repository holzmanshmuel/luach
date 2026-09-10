import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';

interface TenantStore { familyId: number; }
const storage = new AsyncLocalStorage<TenantStore>();

/** Mutable per-request holder for the active family. */
interface RequestHolder { familyId: number | null; }

/**
 * Resolver that returns the request-scoped holder object. In production this is
 * React's cache(), which memoizes per RSC RENDER PASS: within one render every
 * call returns the SAME mutable object, and every render gets a FRESH one (no
 * cross-request leakage).
 *
 * ⚠️ It memoizes during a RENDER — not inside a Server Action, and not in a
 * script, a route handler or a test. There `cache()` is a pass-through that
 * returns a fresh object per call, so the holder is inert: a familyId written to
 * it inside an awaited guard is written to an object nobody else will ever see.
 * That is why enterTenant() is NOT sufficient for a mutation, and why every
 * Server Action goes through runWithTenant() (the with* wrappers in lib/auth.ts).
 * See src/lib/tenant-runtime.test.ts, which proves both directions against a real
 * database with no render in scope.
 */
type HolderResolver = <H>(factory: () => H) => H;

// Stable factory reference — the injected test resolver (and React cache())
// memoize per request keyed on THIS identity, so every call within one request
// returns the same holder object.
const makeHolder = (): RequestHolder => ({ familyId: null });
const cachedHolder = cache(makeHolder);
let holderResolver: HolderResolver | null = null;

function requestHolder(): RequestHolder {
  // When a test has injected a resolver, route the holder through it so tests
  // can drive per-request memoization faithfully. Otherwise use React cache().
  if (holderResolver) return holderResolver(makeHolder);
  return cachedHolder();
}

/** TEST-ONLY: inject a per-request memoization resolver (mimics React cache()). */
export function __setRequestHolderResolver(resolver: HolderResolver): void {
  holderResolver = resolver;
}
/** TEST-ONLY: restore the default (React cache()) resolver. */
export function __resetRequestHolderResolver(): void {
  holderResolver = null;
}

/**
 * Set the active family for the remainder of the current RENDER.
 *
 * Writes BOTH:
 *  - the request-scoped holder, which survives an `await` boundary WITHIN ONE RSC
 *    RENDER (React cache() memoizes it there), and
 *  - the AsyncLocalStorage store via enterWith(), which binds only the calling
 *    async context's own continuation.
 *
 * ⚠️ NEITHER survives an awaited guard returning to its caller inside a SERVER
 * ACTION. `cache()` does not memoize per request there, so the holder write lands
 * on a throwaway object; and enterWith() called after an await binds the callee's
 * continuation, not the caller's — so when the guard's promise resolves the action
 * resumes with no tenant and the next query() throws "No tenant context".
 *
 * So: enterTenant() is for PAGES/renders. A Server Action must run its body inside
 * runWithTenant() — use the with* wrappers in lib/auth.ts, which do exactly that.
 */
export function enterTenant(familyId: number): void {
  requestHolder().familyId = familyId;
  storage.enterWith({ familyId });
}

/**
 * Current tenant, or null when none has been established (fail-closed callers
 * should throw).
 *
 * Checks the AsyncLocalStorage store FIRST so runWithTenant() callbacks (API
 * routes, cron jobs, tests, scripts) keep working and take precedence, then
 * falls back to the request-scoped holder set by enterTenant().
 */
export function getFamilyId(): number | null {
  return storage.getStore()?.familyId ?? requestHolder().familyId ?? null;
}

/**
 * Callback form, and the ONLY reliable primitive: AsyncLocalStorage.run() wraps
 * `fn` unambiguously, so every await inside it — and every query() and
 * withTransaction() reached from it — sees this family. Used by API routes and
 * cron jobs that act on a family explicitly, and by every Server Action via the
 * with* wrappers in lib/auth.ts.
 */
export function runWithTenant<T>(familyId: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ familyId }, fn);
}

/**
 * The largest value a `family_id` can hold: Postgres `integer` is signed 32-bit.
 *
 * `Number.isInteger()` happily accepts 9999999999, which then reaches the query
 * and blows up inside the driver as an uncaught 500 — a malformed request being
 * reported as a server fault, on every machine-facing route at once. Bounding the
 * value where it is parsed turns that into the 400 it always was.
 */
export const MAX_FAMILY_ID = 2_147_483_647;

/** Is `value` a usable family id — a positive integer inside Postgres' int4 range? */
export function isValidFamilyId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value > 0 && value <= MAX_FAMILY_ID;
}
