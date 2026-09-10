import { describe, it, expect } from 'vitest';
import { computeBranchWarnings } from './branch-draft';

/**
 * The /admin/branches page's job is to make the cost of an edit visible BEFORE it
 * is saved. These tests pin the two mistakes the page exists to prevent —
 * reshuffling colours the family already recognises, and stranding people under a
 * branch value that no longer exists — and, just as importantly, pin that the SAFE
 * edit (appending) raises no alarm at all. A warning that cries wolf on the safe
 * path gets ignored on the dangerous one.
 */

const SAVED = ['Levi', 'Cohen', 'Mizrahi', 'Other'];
const COUNTS = { Levi: 12, Cohen: 5, Mizrahi: 1, Other: 3 };

const texts = (saved: readonly string[], draft: readonly string[], counts = COUNTS) =>
  computeBranchWarnings(saved, draft, counts).map(w => w.text).join(' | ');

describe('computeBranchWarnings — the safe edits are silent', () => {
  it('says nothing about an unchanged list', () => {
    expect(computeBranchWarnings(SAVED, SAVED, COUNTS)).toEqual([]);
  });

  it('says nothing about APPENDING a branch above the catch-all', () => {
    // The catch-all's index moves from 3 to 4, but it is neutral at any index, so
    // no colour changes and nothing needs saying.
    const draft = ['Levi', 'Cohen', 'Mizrahi', 'Adler', 'Other'];
    expect(computeBranchWarnings(SAVED, draft, COUNTS)).toEqual([]);
  });

  it('ignores whitespace an owner leaves while typing', () => {
    expect(computeBranchWarnings(SAVED, ['Levi ', ' Cohen', 'Mizrahi', 'Other '], COUNTS)).toEqual([]);
  });

  it('says nothing about branch values that were ALREADY unlisted', () => {
    // A legacy value in the DB is not this draft's fault.
    const counts = { ...COUNTS, Legacy: 4 };
    expect(computeBranchWarnings(SAVED, SAVED, counts)).toEqual([]);
  });
});

describe('computeBranchWarnings — reordering', () => {
  it('cautions when a reorder changes colours, and names the branches affected', () => {
    const draft = ['Cohen', 'Levi', 'Mizrahi', 'Other'];
    const ws = computeBranchWarnings(SAVED, draft, COUNTS);
    const colour = ws.find(w => /changes the colour/.test(w.text));
    expect(colour?.tone).toBe('caution');
    expect(colour!.text).toContain('Levi');
    expect(colour!.text).toContain('Cohen');
    // Mizrahi never moved, so it must not be listed.
    expect(colour!.text).not.toContain('Mizrahi');
  });

  it('cautions loudly when a different branch is made the catch-all', () => {
    // Levi -> the end. Levi loses its colour, and every branch behind it shifts up.
    const draft = ['Cohen', 'Mizrahi', 'Other', 'Levi'];
    const out = texts(SAVED, draft);
    expect(out).toMatch(/changes the colour of 4 branches/);
    expect(out).toMatch(/"Levi" becomes the catch-all/);
    expect(out).toMatch(/"Other" stops being the catch-all/);
  });

  it('does not claim a colour change for a branch that stayed put', () => {
    // Swap the last two named branches; Levi (slot 0) is untouched.
    const draft = ['Levi', 'Mizrahi', 'Cohen', 'Other'];
    const colour = computeBranchWarnings(SAVED, draft, COUNTS)
      .find(w => /changes the colour/.test(w.text))!;
    expect(colour.text).toContain('Cohen');
    expect(colour.text).toContain('Mizrahi');
    expect(colour.text).not.toMatch(/\bLevi\b/);
  });
});

describe('computeBranchWarnings — removals and renames strand people', () => {
  it('counts the people a removal would leave rendering neutral', () => {
    const draft = ['Levi', 'Mizrahi', 'Other'];
    const ws = computeBranchWarnings(SAVED, draft, COUNTS);
    const stranded = ws.find(w => /filed under "Cohen"/.test(w.text))!;
    expect(stranded.tone).toBe('caution');
    expect(stranded.text).toMatch(/^5 people are filed under "Cohen"/);
    expect(stranded.text).toMatch(/plain grey/);
  });

  it('says the same about a RENAME — the stored value on each person is unchanged', () => {
    // This is the point the page has to land: renaming keeps the colour but does
    // NOT re-file anybody.
    const draft = ['Levy', 'Cohen', 'Mizrahi', 'Other'];
    const out = texts(SAVED, draft);
    expect(out).toMatch(/12 people are filed under "Levi"/);
  });

  it('uses singular English for exactly one person', () => {
    const draft = ['Levi', 'Cohen', 'Other'];
    expect(texts(SAVED, draft)).toMatch(/^1 person is filed under "Mizrahi"/);
  });

  it('stays quiet about a branch nobody is filed under', () => {
    const draft = ['Levi', 'Cohen', 'Other'];
    const counts = { ...COUNTS, Mizrahi: 0 };
    expect(texts(SAVED, draft, counts)).not.toMatch(/Mizrahi/);
  });

  it('reports the biggest strand first', () => {
    const draft = ['Mizrahi', 'Other'];
    const ws = computeBranchWarnings(SAVED, draft, COUNTS);
    expect(ws[0].text).toMatch(/"Levi"/); // 12 people
    expect(ws[1].text).toMatch(/"Cohen"/); // 5 people
  });

  it('confirms a harmless rename instead of warning about it', () => {
    const counts = { Other: 3 }; // nobody filed under any named branch yet
    const draft = ['Levy', 'Cohen', 'Mizrahi', 'Other'];
    const ws = computeBranchWarnings(SAVED, draft, counts);
    expect(ws).toHaveLength(1);
    expect(ws[0].tone).toBe('info');
    expect(ws[0].text).toMatch(/1 branch is renamed in place/);
    expect(ws[0].text).toMatch(/keeps its colour/);
  });

  it('does not guess "rename" once the list changed length', () => {
    // An INSERT shifts every later entry, which looks index-for-index like a series
    // of renames. Claiming that would be a lie, so only the real cost is reported.
    const draft = ['Levi', 'Cohen', 'Adler', 'Mizrahi', 'Other'];
    const counts = { Other: 3 };
    const ws = computeBranchWarnings(SAVED, draft, counts);
    const out = ws.map(w => w.text).join(' ');
    expect(out).not.toMatch(/renamed in place/);
    // …and the genuine cost of an insert IS reported: Mizrahi moved a slot.
    expect(out).toMatch(/changes the colour of 1 branch: Mizrahi/);
  });
});
