import { timingSafeEqual } from 'crypto';

/**
 * Length-independent, constant-time string comparison. Use for comparing secrets
 * (tokens, passwords) so a timing side-channel can't leak how many leading
 * characters matched. Returns false for length mismatch without leaking timing
 * beyond the length itself.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
