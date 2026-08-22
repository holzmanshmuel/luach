/**
 * In-process, fixed-window rate limiter.
 *
 * SINGLE-INSTANCE BY DESIGN. State lives in one process-local Map, so the counts
 * are only correct when the app runs as ONE instance (our Railway deployment is a
 * single instance — no Redis dependency wanted). If this ever scales horizontally,
 * each replica keeps its own counters and the effective limit multiplies by the
 * replica count; swap this for a shared store (Redis) before scaling out.
 *
 * Fixed window: each key gets a window that starts at its first hit; the count
 * resets wholesale once `windowMs` elapses. Simpler (and cheaper) than a sliding
 * window, and fine for the coarse abuse caps we apply here.
 *
 * The store is bounded: if it would exceed RATE_LIMIT_MAX_KEYS, we lazily prune
 * expired windows first, and if still over cap, drop the oldest window. That caps
 * memory even under a flood of distinct keys (e.g. spoofed X-Forwarded-For IPs).
 */

interface Bucket {
  count: number;
  windowStart: number;
}

/** Hard cap on tracked keys; keeps memory bounded under key-space flooding. */
export const RATE_LIMIT_MAX_KEYS = 10_000;

// Cached on globalThis so it survives Next dev hot-reloads (the module is
// re-evaluated on change; a plain module-level Map would reset and lose counts).
declare global {
  var _rateLimitStore: Map<string, Bucket> | undefined;
}

function getStore(): Map<string, Bucket> {
  if (!globalThis._rateLimitStore) {
    globalThis._rateLimitStore = new Map<string, Bucket>();
  }
  return globalThis._rateLimitStore;
}

/** Test-only: clear the shared store so cases don't bleed into each other. */
export function __resetRateLimitStore(): void {
  getStore().clear();
}

/**
 * Drop entries to keep the store under the cap. First removes windows that have
 * fully expired (cheap and correct); if still over cap, evicts the single oldest
 * window (by windowStart) — an approximate-LRU good enough for an abuse guard.
 */
function prune(store: Map<string, Bucket>, now: number, windowMs: number): void {
  if (store.size < RATE_LIMIT_MAX_KEYS) return;

  for (const [k, b] of store) {
    if (now - b.windowStart >= windowMs) store.delete(k);
  }
  if (store.size < RATE_LIMIT_MAX_KEYS) return;

  // Still full of live windows — evict the oldest so we never grow unbounded.
  let oldestKey: string | undefined;
  let oldestStart = Infinity;
  for (const [k, b] of store) {
    if (b.windowStart < oldestStart) {
      oldestStart = b.windowStart;
      oldestKey = k;
    }
  }
  if (oldestKey !== undefined) store.delete(oldestKey);
}

/**
 * Record a hit for `key` and report whether it is allowed under the fixed window.
 *
 * @returns `{ ok: true }` when under the limit, or
 *          `{ ok: false, retryAfterSec }` when the window is exhausted, where
 *          `retryAfterSec` is the whole-seconds wait until the window resets
 *          (always >= 1 so a caller never busy-loops).
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): { ok: boolean; retryAfterSec?: number } {
  const { limit, windowMs } = opts;
  const now = Date.now();
  const store = getStore();

  const existing = store.get(key);

  // No window yet, or the previous window has fully elapsed → start a fresh one.
  if (!existing || now - existing.windowStart >= windowMs) {
    prune(store, now, windowMs);
    store.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }

  if (existing.count < limit) {
    existing.count += 1;
    return { ok: true };
  }

  // Window exhausted — compute the wait until it resets.
  const elapsed = now - existing.windowStart;
  const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
  return { ok: false, retryAfterSec };
}
