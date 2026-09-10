import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  enterTenant,
  getFamilyId,
  __setRequestHolderResolver,
  __resetRequestHolderResolver,
} from '@/lib/tenant';

/**
 * ⚠️ WHAT THIS FILE DOES AND DOES NOT PROVE — read before trusting it.
 *
 * It tests ONE contract: given a resolver that memoizes per request, a familyId
 * written to the holder inside an awaited callee is visible to the caller once
 * that callee resolves, and two requests stay isolated. That contract holds, and
 * it is worth keeping — a RENDER really does behave this way.
 *
 * It does NOT exercise the production Server Action path, because the resolver it
 * memoizes with is a STAND-IN this file injects (`__setRequestHolderResolver`),
 * not React's `cache()`. The real `cache()` memoizes during an RSC RENDER PASS
 * only. Inside a Server Action it is a pass-through returning a fresh object per
 * call, so the holder write lands on an object nobody reads and the caller resumes
 * with no tenant — exactly the "No tenant context: query() called without an
 * active family." that broke every add/edit/delete in the app while every page
 * rendered fine. THIS FILE PASSED THROUGHOUT. It asserted the design contract,
 * never the runtime.
 *
 * The runtime is covered by `tenant-runtime.test.ts`, which runs a guard → await →
 * real tenant-scoped `query()` against a real Postgres with no render in scope,
 * and asserts both directions: through the wrapper it writes the row, and without
 * the wrapper it throws.
 *
 * The general lesson, since this cost a production outage: a test that injects a
 * stand-in for the mechanism under test cannot fail the way production fails.
 */

// A per-"request" scope: one Map per request, so cache()-style memoization
// returns a single shared holder object for the life of that request.
const requestScope = new AsyncLocalStorage<Map<unknown, unknown>>();

/** Run `fn` as if inside one Next request (one memoization scope). */
function withRequest<T>(fn: () => Promise<T>): Promise<T> {
  return requestScope.run(new Map(), fn);
}

beforeEach(() => {
  // Point tenant.ts's holder at our test-driven per-request memoization, which
  // mimics what React cache() does inside a real RENDER — and, crucially, NOT
  // what it does inside a Server Action (see the file header).
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

describe('holder contract: a per-request memoized holder survives guard boundaries', () => {
  it('propagation: enterTenant() after an await is visible to the caller once the callee resolves', async () => {
    // Mimic an auth guard: it awaits (getSession/getMembership), THEN enters tenant.
    async function guard(): Promise<void> {
      await Promise.resolve(); // <-- the await that breaks enterWith()-only
      enterTenant(42);
    }

    await withRequest(async () => {
      expect(getFamilyId()).toBeNull(); // no tenant before the guard runs
      await guard();
      // With enterWith() alone this is null here (context lost on return); it is
      // 42 only because the injected resolver memoizes the holder, as a render
      // does. A Server Action gets the null — hence runWithTenant().
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
