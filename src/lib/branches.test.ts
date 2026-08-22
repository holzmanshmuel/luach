import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_FAMILY_BRANCHES,
  BRANCH_STYLES,
  NEUTRAL_BRANCH_STYLE,
  parseBranchList,
  catchAllBranch,
  namedBranches,
  isCatchAllBranch,
  branchSlot,
  branchBucket,
  branchStyle,
} from './branches';
import { familyBranches } from './branches-server';

/**
 * Family branches are configuration, and their ORDER is load-bearing: a branch's
 * colour is its POSITION in the configured list, and the LAST position is the
 * catch-all. A production deployment supplies its own real branch names in the
 * same order the old hardcoded union type had them, and every family member
 * keeps the colour they have always seen. These tests pin that:
 *
 *   position -> colour, list -> configuration, unknown -> neutral (never a crash).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const CUSTOM = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Elsewhere'];

describe('familyBranches() — the configuration point', () => {
  it('returns the built-in default with zero configuration', () => {
    vi.stubEnv('FAMILY_BRANCHES', undefined);
    expect(familyBranches()).toEqual([...DEFAULT_FAMILY_BRANCHES]);
  });

  it('returns an empty/whitespace-only setting as the default too', () => {
    vi.stubEnv('FAMILY_BRANCHES', '  ,  , ');
    expect(familyBranches()).toEqual([...DEFAULT_FAMILY_BRANCHES]);
  });

  it('respects a custom comma-separated list', () => {
    vi.stubEnv('FAMILY_BRANCHES', CUSTOM.join(','));
    expect(familyBranches()).toEqual(CUSTOM);
  });

  it('tolerates the spacing people actually type', () => {
    vi.stubEnv('FAMILY_BRANCHES', ' Alpha ,Beta,  Gamma ,, Delta ,Elsewhere, ');
    expect(familyBranches()).toEqual(CUSTOM);
  });

  it('accepts non-Latin branch names unchanged', () => {
    vi.stubEnv('FAMILY_BRANCHES', 'לוי,כהן,אחר');
    expect(familyBranches()).toEqual(['לוי', 'כהן', 'אחר']);
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
