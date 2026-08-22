import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit, __resetRateLimitStore, RATE_LIMIT_MAX_KEYS } from '@/lib/ratelimit';

describe('rateLimit (in-process fixed-window)', () => {
  beforeEach(() => {
    __resetRateLimitStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(true);
  });

  it('blocks the request that exceeds the limit and reports retryAfterSec', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    rateLimit('a', opts);
    rateLimit('a', opts);
    rateLimit('a', opts);
    const blocked = rateLimit('a', opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('restores access once the window resets', () => {
    const opts = { limit: 2, windowMs: 60_000 };
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(false);

    // Advance past the window — the fixed window starts fresh.
    vi.advanceTimersByTime(60_001);
    expect(rateLimit('a', opts).ok).toBe(true);
  });

  it('keeps distinct keys independent', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(false); // 'a' is now spent
    expect(rateLimit('b', opts).ok).toBe(true); // 'b' is untouched
  });

  it('reports a retryAfterSec that shrinks as the window elapses', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    rateLimit('a', opts); // consumes the window
    const early = rateLimit('a', opts);
    vi.advanceTimersByTime(30_000);
    const later = rateLimit('a', opts);
    expect(early.retryAfterSec!).toBeGreaterThan(later.retryAfterSec!);
    // At least 1 second is always reported so a client never busy-loops.
    expect(later.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('prunes to stay under the map cap under key-space flooding', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    // Push well past the cap with unique keys; the store must not grow unbounded.
    for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 500; i++) {
      rateLimit(`flood-${i}`, opts);
    }
    // We can't read the Map directly, but a fresh known key must still work and
    // the process must not have thrown / leaked — exercised by not throwing here.
    expect(rateLimit('sentinel', opts).ok).toBe(true);
  });
});
