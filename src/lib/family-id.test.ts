import { describe, it, expect } from 'vitest';
import { isValidFamilyId, MAX_FAMILY_ID } from './tenant';

/**
 * `Number.isInteger()` accepts any integer, including ones far beyond Postgres'
 * signed 32-bit `integer`. Those reached the query and threw inside the driver as
 * an uncaught 500 — a malformed request reported as a server fault — on all four
 * machine-facing routes at once.
 */
describe('isValidFamilyId', () => {
  it('accepts a real id', () => {
    expect(isValidFamilyId(1)).toBe(true);
    expect(isValidFamilyId(MAX_FAMILY_ID)).toBe(true);
  });

  it('rejects anything past the int4 ceiling, which is what caused the 500s', () => {
    expect(isValidFamilyId(MAX_FAMILY_ID + 1)).toBe(false);
    expect(isValidFamilyId(9_999_999_999)).toBe(false);
    expect(isValidFamilyId(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('rejects zero, negatives and fractions', () => {
    for (const v of [0, -1, -MAX_FAMILY_ID, 1.5, -0.0001]) {
      expect(isValidFamilyId(v)).toBe(false);
    }
  });

  it('rejects the non-numbers a query string can produce', () => {
    for (const v of [NaN, Infinity, -Infinity, null, undefined, '1', '', [], {}]) {
      expect(isValidFamilyId(v)).toBe(false);
    }
  });
});
