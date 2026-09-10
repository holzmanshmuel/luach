import { describe, it, expect } from 'vitest';
import { buildVariants, makeViewerSpelling } from './spelling-core';

// The default (fictional) branch list — the fixture keeps using it, but nothing
// here depends on the NAMES: `buildVariants` only knows that the last entry is
// the catch-all.
const BRANCHES = ['Levi', 'Cohen', 'Mizrahi', 'Adler', 'Other'];

describe('buildVariants', () => {
  it('seeds each named branch with its own value first; skips the catch-all', () => {
    const v = buildVariants(BRANCHES, [
      { branch: 'Levi', spelling: 'Levy' },
      { branch: 'Levi', spelling: 'Levine' },
    ]);
    expect(v.Levi).toEqual(['Levi', 'Levy', 'Levine']);
    expect(v.Cohen).toEqual(['Cohen']);
    expect(v.Other).toBeUndefined();
  });

  it('does not duplicate the canonical if added as a row', () => {
    const v = buildVariants(BRANCHES, [{ branch: 'Adler', spelling: 'Adler' }]);
    expect(v.Adler).toEqual(['Adler']);
  });

  it('works off a custom configured list, skipping ITS last entry', () => {
    const v = buildVariants(['Alpha', 'Beta', 'Elsewhere'], []);
    expect(Object.keys(v).sort()).toEqual(['Alpha', 'Beta']);
    expect(v.Alpha).toEqual(['Alpha']);
    expect(v.Elsewhere).toBeUndefined();
  });

  it('keeps a stored spelling whose branch is no longer configured', () => {
    // Someone renamed a branch in FAMILY_BRANCHES; the spellings row survives
    // rather than silently disappearing from the viewer's options.
    const v = buildVariants(['Alpha', 'Elsewhere'], [{ branch: 'Retired', spelling: 'Retyred' }]);
    expect(v.Retired).toEqual(['Retired', 'Retyred']);
  });
});

describe('spell()', () => {
  const variants = buildVariants(BRANCHES, [{ branch: 'Levi', spelling: 'Levy' }]);

  it('returns the branch value by default', () => {
    const vs = makeViewerSpelling(variants, {});
    expect(vs.spell('Levi')).toBe('Levi');
  });

  it('returns the chosen spelling when valid', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levy' });
    expect(vs.spell('Levi')).toBe('Levy');
  });

  it('falls back to the branch value when the chosen spelling no longer exists', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Deleted' });
    expect(vs.spell('Levi')).toBe('Levi');
  });

  it('passes through null/empty branch', () => {
    const vs = makeViewerSpelling(variants, {});
    expect(vs.spell(null)).toBeNull();
  });
});

describe('applyToName', () => {
  const variants = buildVariants(BRANCHES, [
    { branch: 'Levi', spelling: 'Levy' },
    { branch: 'Levi', spelling: 'Levine' },
    { branch: 'Cohen', spelling: 'Kohn' },
  ]);

  it('rewrites the surname inside a full name to the chosen spelling', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levi' });
    expect(vs.applyToName('Dov Levy', 'Levi')).toBe('Dov Levi');
  });

  it('rewrites toward a chosen non-canonical spelling', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levy' });
    expect(vs.applyToName('Dov Levi', 'Levi')).toBe('Dov Levy');
    expect(vs.applyToName('Dov Levine', 'Levi')).toBe('Dov Levy');
  });

  it('leaves the name unchanged when it already uses the chosen spelling', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levy' });
    expect(vs.applyToName('Dov Levy', 'Levi')).toBe('Dov Levy');
  });

  it('only touches the surname of the matching branch', () => {
    const vs = makeViewerSpelling(variants, { Cohen: 'Kohn' });
    // person is in the Cohen branch; a stray "Levy" token is left alone
    expect(vs.applyToName('Leah Cohen', 'Cohen')).toBe('Leah Kohn');
  });

  it('does not partial-match inside another word', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levi' });
    expect(vs.applyToName('Leviathan Road', 'Levi')).toBe('Leviathan Road');
  });

  it('matches case-insensitively but writes the chosen casing', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levi' });
    expect(vs.applyToName('dov levy', 'Levi')).toBe('dov Levi');
  });

  it('does not cross scripts: a Latin choice leaves a Hebrew name alone', () => {
    const v2 = buildVariants(BRANCHES, [
      { branch: 'Levi', spelling: 'Levy' },
      { branch: 'Levi', spelling: 'לוי' },
    ]);
    const vs = makeViewerSpelling(v2, { Levi: 'Levy' });
    expect(vs.applyToName('דוד לוי', 'Levi')).toBe('דוד לוי');
  });

  it('leaves names with no matching surname untouched (married-in / maiden)', () => {
    const vs = makeViewerSpelling(variants, { Levi: 'Levy' });
    expect(vs.applyToName('Sara Bloom', 'Levi')).toBe('Sara Bloom');
  });

  it('does NOT rewrite when the viewer has made no choice (opt-in only)', () => {
    const vs = makeViewerSpelling(variants, {}); // no choice for any branch
    // Even though "Levy" is a known variant of Levi, leave it as stored.
    expect(vs.applyToName('Miriam Levy', 'Levi')).toBe('Miriam Levy');
    expect(vs.applyToName('Yosef Levi', 'Levi')).toBe('Yosef Levi');
  });
});
