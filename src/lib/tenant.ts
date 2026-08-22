import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';

interface TenantStore { familyId: number; }
const storage = new AsyncLocalStorage<TenantStore>();

/** Mutable per-request holder for the active family. */
interface RequestHolder { familyId: number | null; }

/**
 * Resolver that returns the request-scoped holder object. In production this is
 * React's cache(): it memoizes once per RSC render pass / server action, so
 * every call within a single request returns the SAME mutable object, and every
 * request gets a FRESH one (no cross-request leakage). See Next 16 docs —
 * "multiple calls within the same request return the same memoized result"
 * (fetching-data) and the DAL pattern in data-security / authentication guides.
 *
 * Outside a React request (tests, scripts, API routes that use runWithTenant),
 * the public `react` cache() export is a pass-through that returns a fresh
 * object each call — so the holder path is simply inert there and the
 * AsyncLocalStorage path (below) takes over. It never throws outside a render,
 * so no try/catch is needed.
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
 * Set the active family for the remainder of the current request.
 *
 * Writes BOTH:
 *  - the request-scoped holder (survives an `await` boundary within one RSC
 *    render / server action — the real fix; enterWith() alone is lost when an
 *    awaited callee like an auth guard resolves back to its caller), and
 *  - the AsyncLocalStorage store via enterWith() (harmless; kept so behavior is
 *    unchanged for any purely-synchronous same-context caller).
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

/** Callback form — for API routes / cron jobs that act on a specific family explicitly. */
export function runWithTenant<T>(familyId: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ familyId }, fn);
}
