import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FAMILY_BRANCHES,
  BRANCH_STYLES,
  NEUTRAL_BRANCH_STYLE,
  MAX_BRANCHES,
  MAX_BRANCH_NAME_LENGTH,
  parseBranchList,
  sanitizeBranchList,
  resolveBranches,
  catchAllBranch,
  namedBranches,
  isCatchAllBranch,
  branchSlot,
  branchBucket,
  branchStyle,
} from './branches';

/**
 * Family branches are configuration, and their ORDER is load-bearing: a branch's
 * colour is its POSITION in the configured list, and the LAST position is the
 * catch-all. A production deployment supplies its own real branch names in the
 * same order the old hardcoded union type had them, and every family member
 * keeps the colour they have always seen. These tests pin that:
 *
 *   position -> colour, list -> configuration, unknown -> neutral (never a crash).
 *
 * The list is now PER-FAMILY data with the environment as a fallback, so the
 * end-to-end resolution (family row -> FAMILY_BRANCHES -> default) is tested
 * against a real database in branches-server.test.ts. Everything here is pure.
 */

const CUSTOM = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Elsewhere'];

describe('parseBranchList — parsing a FAMILY_BRANCHES value', () => {
  it('returns the built-in default for unset / empty / whitespace-only', () => {
    expect(parseBranchList(undefined)).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    expect(parseBranchList(null)).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    expect(parseBranchList('')).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    expect(parseBranchList('  ,  , ')).toEqual([...DEFAULT_FAMILY_BRANCHES]);
  });

  it('respects a custom comma-separated list', () => {
    expect(parseBranchList(CUSTOM.join(','))).toEqual(CUSTOM);
  });

  it('tolerates the spacing people actually type', () => {
    expect(parseBranchList(' Alpha ,Beta,  Gamma ,, Delta ,Elsewhere, ')).toEqual(CUSTOM);
  });

  it('accepts non-Latin branch names unchanged', () => {
    expect(parseBranchList('לוי,כהן,אחר')).toEqual(['לוי', 'כהן', 'אחר']);
  });
});

describe('parseBranchList', () => {
  it('collapses duplicates, keeping the FIRST position (colours must not shift)', () => {
    expect(parseBranchList('Alpha,Beta,Alpha,Gamma')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('accepts a single-entry list literally — that entry is the catch-all', () => {
    const one = parseBranchList('OnlyOne');
    expect(one).toEqual(['OnlyOne']);
    expect(catchAllBranch(one)).toBe('OnlyOne');
    expect(namedBranches(one)).toEqual([]);
  });
});

describe('catch-all handling', () => {
  it('treats the LAST configured branch as the catch-all', () => {
    expect(catchAllBranch(CUSTOM)).toBe('Elsewhere');
    expect(namedBranches(CUSTOM)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(isCatchAllBranch(CUSTOM, 'Elsewhere')).toBe(true);
    expect(isCatchAllBranch(CUSTOM, 'Alpha')).toBe(false);
  });

  it('counts unset and unrecognised values as catch-all', () => {
    expect(isCatchAllBranch(CUSTOM, null)).toBe(true);
    expect(isCatchAllBranch(CUSTOM, undefined)).toBe(true);
    expect(isCatchAllBranch(CUSTOM, '')).toBe(true);
    expect(isCatchAllBranch(CUSTOM, 'NotConfigured')).toBe(true);
  });

  it('files unset and unrecognised values under the catch-all for filtering', () => {
    expect(branchBucket(CUSTOM, 'Beta')).toBe('Beta');
    expect(branchBucket(CUSTOM, null)).toBe('Elsewhere');
    expect(branchBucket(CUSTOM, 'NotConfigured')).toBe('Elsewhere');
    expect(branchBucket([], 'anything')).toBeNull();
  });
});

describe('branchSlot — colour is POSITION, not name', () => {
  it('gives each named branch its own position', () => {
    expect(branchSlot(CUSTOM, 'Alpha')).toBe(0);
    expect(branchSlot(CUSTOM, 'Beta')).toBe(1);
    expect(branchSlot(CUSTOM, 'Gamma')).toBe(2);
    expect(branchSlot(CUSTOM, 'Delta')).toBe(3);
  });

  it('gives the catch-all, unknown and unset values no slot', () => {
    expect(branchSlot(CUSTOM, 'Elsewhere')).toBe(-1);
    expect(branchSlot(CUSTOM, 'NotConfigured')).toBe(-1);
    expect(branchSlot(CUSTOM, null)).toBe(-1);
  });
});

describe('branchStyle', () => {
  it('assigns the palette strictly by position', () => {
    expect(branchStyle(CUSTOM, 'Alpha')).toBe(BRANCH_STYLES[0]);
    expect(branchStyle(CUSTOM, 'Beta')).toBe(BRANCH_STYLES[1]);
    expect(branchStyle(CUSTOM, 'Gamma')).toBe(BRANCH_STYLES[2]);
    expect(branchStyle(CUSTOM, 'Delta')).toBe(BRANCH_STYLES[3]);
  });

  it('is name-blind: a differently-named list of the same length gets identical colours', () => {
    // This is the production-migration contract. The deployment supplies its own
    // five real branch names in the SAME order the old union type listed them,
    // and nobody's colour moves.
    const defaults = [...DEFAULT_FAMILY_BRANCHES];
    for (let i = 0; i < defaults.length; i++) {
      expect(branchStyle(CUSTOM, CUSTOM[i])).toBe(branchStyle(defaults, defaults[i]));
    }
  });

  it('degrades an unknown branch value to the neutral treatment, never a crash', () => {
    expect(branchStyle(CUSTOM, 'A Branch Nobody Configured')).toBe(NEUTRAL_BRANCH_STYLE);
    expect(branchStyle(CUSTOM, null)).toBe(NEUTRAL_BRANCH_STYLE);
    expect(branchStyle(CUSTOM, undefined)).toBe(NEUTRAL_BRANCH_STYLE);
    expect(branchStyle([], 'anything')).toBe(NEUTRAL_BRANCH_STYLE);
  });

  it('gives the catch-all the neutral treatment', () => {
    expect(branchStyle(CUSTOM, 'Elsewhere')).toBe(NEUTRAL_BRANCH_STYLE);
    expect(branchStyle([...DEFAULT_FAMILY_BRANCHES], 'Other')).toBe(NEUTRAL_BRANCH_STYLE);
  });

  it('wraps rather than breaking when there are more branches than palette entries', () => {
    const many = [...Array(BRANCH_STYLES.length + 2).keys()].map(i => `B${i}`).concat('Rest');
    for (const b of namedBranches(many)) {
      expect(branchStyle(many, b)).toBeDefined();
    }
    // Position N wraps to palette slot 0.
    expect(branchStyle(many, `B${BRANCH_STYLES.length}`)).toBe(BRANCH_STYLES[0]);
  });

  it('returns every tint the UI needs, so the surfaces cannot drift apart', () => {
    const s = branchStyle(CUSTOM, 'Alpha');
    for (const key of ['bg', 'fg', 'dot', 'accent', 'border'] as const) {
      expect(typeof s[key]).toBe('string');
      expect(s[key].length).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeBranchList — cleaning an already-split list', () => {
  it('trims, collapses inner whitespace, drops blanks, dedupes keeping the FIRST', () => {
    expect(sanitizeBranchList([' Alpha ', '', 'Beta', '  ', 'Alpha', 'Gam  ma'])).toEqual([
      'Alpha', 'Beta', 'Gam ma',
    ]);
  });

  it('returns [] for nothing usable — it does NOT invent a default', () => {
    expect(sanitizeBranchList(null)).toEqual([]);
    expect(sanitizeBranchList(undefined)).toEqual([]);
    expect(sanitizeBranchList([])).toEqual([]);
    expect(sanitizeBranchList(['   ', ''])).toEqual([]);
  });
});

describe('resolveBranches — the fallback chain', () => {
  const OWN = ['Own1', 'Own2', 'OwnRest'];
  const ENV = 'Env1,Env2,EnvRest';

  it("1st: a family's OWN stored list wins over everything", () => {
    expect(resolveBranches(OWN, ENV)).toEqual(OWN);
    expect(resolveBranches(OWN, undefined)).toEqual(OWN);
  });

  it('2nd: no stored list falls back to the FAMILY_BRANCHES value', () => {
    expect(resolveBranches(null, ENV)).toEqual(['Env1', 'Env2', 'EnvRest']);
    expect(resolveBranches(undefined, ENV)).toEqual(['Env1', 'Env2', 'EnvRest']);
  });

  it('3rd: neither one falls back to the built-in default', () => {
    expect(resolveBranches(null, undefined)).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    expect(resolveBranches(null, '')).toEqual([...DEFAULT_FAMILY_BRANCHES]);
    expect(resolveBranches(undefined, null)).toEqual([...DEFAULT_FAMILY_BRANCHES]);
  });

  it('treats an empty stored list as "no branches", NOT as "not set"', () => {
    // This distinction is a privacy boundary, not a nicety. The env var holds the
    // OPERATOR'S REAL SURNAMES. Falling back to it for a family that has simply
    // not chosen any sides would paint an unrelated family's calendar with
    // another family's names — so an explicit empty list must stay empty.
    // Only NULL/undefined ("this row predates per-family branches") inherits.
    expect(resolveBranches([], ENV)).toEqual([]);
    expect(resolveBranches(['  ', ''], ENV)).toEqual([]);
    expect(resolveBranches([], undefined)).toEqual([]);
  });

  it('renders anyone neutral when a family has no branches at all', () => {
    // Nothing may throw or narrow on the empty list: no catch-all, no named
    // branches, and every person falls to the neutral treatment.
    expect(catchAllBranch([])).toBeNull();
    expect(namedBranches([])).toEqual([]);
    expect(branchSlot([], 'Anything')).toBe(-1);
    expect(branchStyle([], 'Anything')).toEqual(NEUTRAL_BRANCH_STYLE);
    expect(branchStyle([], null)).toEqual(NEUTRAL_BRANCH_STYLE);
    expect(isCatchAllBranch([], 'Anything')).toBe(true);
  });

  it('sanitizes a stored list on the way out', () => {
    expect(resolveBranches([' A ', 'B', 'A', '', 'Rest'], ENV)).toEqual(['A', 'B', 'Rest']);
  });

  it('keeps two families independent — same function, different stored lists', () => {
    const a = resolveBranches(['A1', 'A2', 'ARest'], ENV);
    const b = resolveBranches(['B1', 'BRest'], ENV);
    expect(a).not.toEqual(b);
    // …and neither has picked up the deployment-wide value.
    expect(a).not.toContain('Env1');
    expect(b).not.toContain('Env1');
  });
});

describe('BRANCH_STYLES — the palette', () => {
  /**
   * FROZEN. Colour is assigned by POSITION, so these four are already on screen
   * for existing families: repainting or reordering them would silently change the
   * tint every one of those family members recognises. This is a byte-for-byte copy
   * of the four entries that shipped — if it fails, the palette was edited in place
   * instead of appended to.
   */
  const FROZEN_FIRST_FOUR = [
    { bg: 'bg-[#E4E3D2]', fg: 'text-[#4C4F30]', dot: 'bg-[#4C4F30]', accent: '#4C4F30', border: 'border-s-[#4C4F30]' },
    { bg: 'bg-[#DCE3DD]', fg: 'text-[#3C4A3E]', dot: 'bg-[#3C4A3E]', accent: '#3C4A3E', border: 'border-s-[#3C4A3E]' },
    { bg: 'bg-[#E9DBD3]', fg: 'text-[#6B4A3E]', dot: 'bg-[#6B4A3E]', accent: '#6B4A3E', border: 'border-s-[#6B4A3E]' },
    { bg: 'bg-[#ECE3CE]', fg: 'text-[#6B5A2E]', dot: 'bg-[#6B5A2E]', accent: '#6B5A2E', border: 'border-s-[#6B5A2E]' },
  ];

  it('still starts with the exact four entries that shipped, in that order', () => {
    expect(BRANCH_STYLES.slice(0, 4)).toEqual(FROZEN_FIRST_FOUR);
  });

  it('has at least 8 entries, so a family with 5+ named branches does not collide', () => {
    expect(BRANCH_STYLES.length).toBeGreaterThanOrEqual(8);
  });

  it('gives a 5th named branch a tint of its own (the bug this fixes)', () => {
    // Five named branches plus a catch-all. Before the palette grew, the 5th
    // wrapped back to slot 0 and wore the FIRST branch's tint.
    const five = ['B1', 'B2', 'B3', 'B4', 'B5', 'Rest'];
    const tints = namedBranches(five).map(b => branchStyle(five, b));
    expect(new Set(tints).size).toBe(5);
    expect(branchStyle(five, 'B5')).not.toBe(branchStyle(five, 'B1'));
  });

  it('gives every named branch a distinct tint right up to the palette length', () => {
    const names = [...Array(BRANCH_STYLES.length).keys()].map(i => `B${i}`);
    const list = [...names, 'Rest'];
    const tints = names.map(b => branchStyle(list, b));
    expect(new Set(tints).size).toBe(BRANCH_STYLES.length);
    // …and none of them is the neutral treatment reserved for the catch-all.
    expect(tints).not.toContain(NEUTRAL_BRANCH_STYLE);
  });

  it('has no duplicate entry anywhere — a repeat would waste a slot', () => {
    const seen = BRANCH_STYLES.map(s => JSON.stringify(s));
    expect(new Set(seen).size).toBe(BRANCH_STYLES.length);
  });

  it('keeps every hue distinct from the neutral catch-all treatment', () => {
    for (const s of BRANCH_STYLES) {
      expect(s.accent).not.toBe(NEUTRAL_BRANCH_STYLE.accent);
    }
  });

  it('fills in all five tints, consistently, on every entry', () => {
    for (const s of BRANCH_STYLES) {
      expect(s.accent).toMatch(/^#[0-9A-F]{6}$/);
      // The one dark ink is reused for the initials, the dot, the SVG stroke and
      // the card rule, so those surfaces cannot drift apart.
      expect(s.dot).toBe(`bg-[${s.accent}]`);
      expect(s.border).toBe(`border-s-[${s.accent}]`);
      expect(s.fg).toBe(`text-[${s.accent}]`);
      expect(s.bg).toMatch(/^bg-\[#[0-9A-F]{6}\]$/);
    }
  });

  it('exposes sane list limits', () => {
    expect(MAX_BRANCHES).toBeGreaterThan(BRANCH_STYLES.length);
    expect(MAX_BRANCH_NAME_LENGTH).toBeGreaterThan(0);
  });
});

describe('BRANCH_STYLES — legibility', () => {
  /** WCAG relative luminance / contrast, so "legible" is measured, not eyeballed. */
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** The two paper surfaces a branch accent, dot or rule is ever drawn on. */
  const PAGE = '#F7F8FB';
  const CARD = '#FFFFFF';
  const bgHex = (s: { bg: string }) => s.bg.replace(/^bg-\[/, '').replace(/\]$/, '');

  it('every entry clears WCAG AA for normal text on its own chip', () => {
    for (const s of BRANCH_STYLES) {
      expect(contrast(bgHex(s), s.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every accent stays readable on bare paper too', () => {
    // Each entry carries its own light chip background, so a chip reads the same
    // whatever surface or colour scheme surrounds it; the dark accent ink also has
    // to survive on bare paper, where dots, SVG strokes and card rules sit.
    for (const s of BRANCH_STYLES) {
      expect(contrast(s.accent, PAGE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.accent, CARD)).toBeGreaterThanOrEqual(4.5);
      // The chip background must in turn be distinguishable from the page it sits
      // on, or a light-on-light chip vanishes.
      expect(contrast(bgHex(s), PAGE)).toBeGreaterThan(1.05);
    }
  });

  it('keeps the appended entries in the same restrained register as the frozen four', () => {
    // Guards against someone appending a saturated primary that shouts next to the
    // bone/olive originals: chip backgrounds stay pale, accent inks stay dark.
    for (const s of BRANCH_STYLES) {
      expect(luminance(bgHex(s))).toBeGreaterThan(0.6);
      expect(luminance(s.accent)).toBeLessThan(0.12);
    }
  });
});
