import { describe, it, expect } from 'vitest';
import { clientIpFrom } from './client-ip';

/** A minimal stand-in for a Headers bag. */
const bag = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

/**
 * `x-forwarded-for` is a hop-by-hop header any client can set, so keying rate
 * limits on it alone means rotating one header evaporates every per-IP cap in the
 * app. Demonstrated against the invite limiter: it fired reliably at request 31
 * with a fixed IP, and never fired at all while the value was rotated.
 */
describe('clientIpFrom', () => {
  it('prefers the edge-set header over anything the client sent', () => {
    expect(
      clientIpFrom(bag({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.1, 203.0.113.7',
        'x-real-ip': '198.51.100.9',
      }))
    ).toBe('203.0.113.7');
  });

  it('cannot be steered by a spoofed x-forwarded-for when the edge header is present', () => {
    // The attack: rotate XFF on every request to land in a fresh bucket each time.
    const keys = new Set(
      ['a', 'b', 'c', 'd'].map(spoof =>
        clientIpFrom(bag({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': spoof }))
      )
    );
    expect(keys.size).toBe(1);
  });

  it('falls back to x-real-ip for a non-Cloudflare proxy', () => {
    expect(clientIpFrom(bag({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': 'spoofed' })))
      .toBe('198.51.100.9');
  });

  it('uses the first x-forwarded-for hop only when nothing better exists', () => {
    expect(clientIpFrom(bag({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })))
      .toBe('198.51.100.1');
  });

  it('mints a unique key when no header is usable, never a shared bucket', () => {
    // Keying every header-less caller on one literal would let a single flood
    // lock out all of them — worse than not limiting them.
    const a = clientIpFrom(bag({}));
    const b = clientIpFrom(bag({}));
    expect(a).not.toBe(b);
    expect(clientIpFrom(bag({ 'x-forwarded-for': '   ' }))).not.toBe(
      clientIpFrom(bag({ 'x-forwarded-for': '   ' }))
    );
  });
});
