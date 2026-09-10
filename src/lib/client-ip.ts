import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * A per-request rate-limit key derived from the caller's IP.
 *
 * Uses the first hop of `x-forwarded-for` (the client IP as reported by the
 * proxy). When `x-forwarded-for` is ABSENT we do NOT key on a shared literal
 * like `'unknown'` — that would put every XFF-less caller in one bucket, so a
 * single flood could lock them all out. Instead we mint a per-request-unique
 * key (`randomUUID`), which effectively leaves XFF-less requests un-limited.
 * That's the safer failure mode: never a shared lock-out.
 */
export function clientIp(request: NextRequest): string {
  return clientIpFrom(request.headers);
}

/**
 * The same key, from a bare header bag.
 *
 * Server Components get their headers from `await headers()`, not from a
 * NextRequest, and the invite landing page needs the same per-IP cap the route
 * handler it replaced had. One implementation, two entry points, so the "never key
 * every XFF-less caller on one shared bucket" rule above cannot be re-derived wrong.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff && xff.length > 0 ? xff : randomUUID();
}
