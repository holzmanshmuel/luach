import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  enterTenant,
  getFamilyId,
  __setRequestHolderResolver,
  __resetRequestHolderResolver,
} from '@/lib/tenant';

/**
 * Reproduces the REAL runtime failure (Task 2.6): an auth guard that `await`s
 * (getSession / getMembership) and only THEN calls enterTenant() must leave the
 * tenant visible to its CALLER once the guard's promise resolves.
 *
 * With `AsyncLocalStorage.enterWith()` alone this fails: enterWith() called after
 * an await binds the store to the callee's async continuation only, so when the
 * guard resolves the caller resumes in its own prior (empty) context — every
 * downstream query() then throws 'No tenant context'.
 *
 * The fix is a request-scoped MUTABLE holder (via React cache() in production).
 * `cache()` memoizes per request/render pass, so a value written to the holder
 * inside an awaited callee is visible to the caller after it resolves, AND a
 * fresh holder per request keeps two requests isolated.
 *
 * In the node test environment the public `react` `cache()` export is a
 * pass-through (the memoizing implementation is injected by Next's RSC runtime
 * at request time), so we drive the SAME per-request-memoization contract here
 * via an injectable holder resolver — a Map-backed scope run through
 * AsyncLocalStorage, exactly the shape Next's server runtime provides. This lets
 * the test exercise the holder path faithfully without a full React render.
 */

// A per-"request" scope: one Map per request, so cache()-style memoization
// returns a single shared holder object for the life of that request.
const requestScope = new AsyncLocalStorage<Map<unknown, unknown>>();

/** Run `fn` as if inside one Next request (one memoization scope). */
function withRequest<T>(fn: () => Promise<T>): Promise<T> {
  return requestScope.run(new Map(), fn);
}

beforeEach(() => {
  // Point tenant.ts's holder at our test-driven per-request memoization,
  // mimicking what React cache() does inside a real request.
  __setRequestHolderResolver(<H>(factory: () => H): H => {
    const store = requestScope.getStore();
    if (!store) {
      // Outside any request scope: no memoization (fresh each call), exactly
      // like the public react cache() pass-through outside a render.
      return factory();
    }
    if (!store.has(factory)) store.set(factory, factory());
    return store.get(factory) as H;
  });
});

afterEach(() => {
  __resetRequestHolderResolver();
});

describe('tenant context survives guard boundaries', () => {
  it('propagation: enterTenant() after an await is visible to the caller once the callee resolves', async () => {
    // Mimic an auth guard: it awaits (getSession/getMembership), THEN enters tenant.
    async function guard(): Promise<void> {
      await Promise.resolve(); // <-- the await that breaks enterWith()-only
      enterTenant(42);
    }

    await withRequest(async () => {
      expect(getFamilyId()).toBeNull(); // no tenant before the guard runs
      await guard();
      // THE BUG: with enterWith() alone this is null here (context lost on return).
      expect(getFamilyId()).toBe(42);
    });
  });

  it('isolation: two sequential requests do not leak tenant context; a request that never enters a tenant sees null', async () => {
    // Request 1 establishes a tenant.
    await withRequest(async () => {
      await Promise.resolve();
      enterTenant(7);
      expect(getFamilyId()).toBe(7);
    });

    // Request 2 never enters a tenant — must NOT see request 1's family.
    await withRequest(async () => {
      await Promise.resolve();
      expect(getFamilyId()).toBeNull();
    });

    // Request 3 establishes a different tenant — must see only its own.
    await withRequest(async () => {
      await Promise.resolve();
      enterTenant(99);
      expect(getFamilyId()).toBe(99);
    });
  });
});
