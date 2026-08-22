import { describe, it, expect } from 'vitest';
import { FAMILY_PALETTE, familyColorAt } from './family-color';

describe('family-color', () => {
  it('has at least 8 distinct hex colors', () => {
    expect(FAMILY_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(FAMILY_PALETTE).size).toBe(FAMILY_PALETTE.length);
    for (const c of FAMILY_PALETTE) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
  it('assigns by index and wraps around the palette', () => {
    expect(familyColorAt(0)).toBe(FAMILY_PALETTE[0]);
    expect(familyColorAt(FAMILY_PALETTE.length)).toBe(FAMILY_PALETTE[0]);
    expect(familyColorAt(FAMILY_PALETTE.length + 1)).toBe(FAMILY_PALETTE[1]);
  });
});
