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
  // ── ORDER MATTERS, AND IT IS A SECURITY ORDER ──
  // `x-forwarded-for` is a hop-by-hop header that ANY client can set. Keying on
  // its first value alone means an attacker rotates one header and every per-IP
  // cap in the app evaporates — demonstrated against the invite rate limiter,
  // which reliably fired at request 31 with a fixed IP and never fired at all
  // while the value was rotated.
  //
  // So prefer headers that the edge OVERWRITES rather than forwards:
  //  1. `cf-connecting-ip` — set by Cloudflare on every request that passes
  //     through it, replacing anything the client sent. This deployment sits
  //     behind a Cloudflare Worker, so this is the real client address.
  //  2. `x-real-ip` — the same idea for other reverse proxies.
  //  3. `x-forwarded-for` — client-settable, kept only so a self-hoster behind a
  //     plain proxy still gets some bucketing. Weakest, therefore last.
  //
  // ⚠️ Any of these can be forged by something reaching the origin DIRECTLY,
  // bypassing the edge. Rate limiting is defence in depth here, not the boundary:
  // invite tokens are 256-bit and every guard re-checks membership in the
  // database, so evading a cap buys attempts, not access.
  const trusted =
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  // No usable header: mint a per-request key rather than sharing one literal
  // bucket. Keying every header-less caller on 'unknown' would let one flood
  // lock out all of them — a worse failure than not limiting them at all.
  return trusted && trusted.length > 0 ? trusted : randomUUID();
}
