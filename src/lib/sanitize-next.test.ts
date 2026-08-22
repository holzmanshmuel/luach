import { describe, it, expect } from 'vitest';
import { sanitizeNext } from '@/lib/sanitize-next';

describe('sanitizeNext', () => {
  it('accepts a simple same-origin path', () => {
    expect(sanitizeNext('/x')).toBe('/x');
  });

  it('accepts a same-origin path with a query string', () => {
    expect(sanitizeNext('/x?y=1')).toBe('/x?y=1');
  });

  it('rejects an absolute cross-origin URL', () => {
    expect(sanitizeNext('https://evil.com')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNext('//evil.com')).toBeNull();
  });

  it('rejects a backslash protocol-relative trick', () => {
    expect(sanitizeNext('/\\evil.com')).toBeNull();
  });

  it('rejects a bare path with no leading slash', () => {
    expect(sanitizeNext('evil.com')).toBeNull();
  });

  it('returns null for empty, null, or undefined input', () => {
    expect(sanitizeNext('')).toBeNull();
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
  });
});
