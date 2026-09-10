import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  backArrow,
  CHEVRON_BIDI,
  dirForLang,
  endSide,
  flexRowChevron,
  flexRowSide,
  SIDE_ARROW,
  SIDE_CHEVRON,
  startSide,
  type Dir,
} from './direction';

const DIRS: Dir[] = ['ltr', 'rtl'];

describe('dirForLang', () => {
  it('maps Hebrew to rtl and everything else to ltr', () => {
    expect(dirForLang('he')).toBe('rtl');
    expect(dirForLang('en')).toBe('ltr');
  });
});

describe('a glyph always points at the side it names', () => {
  it('chevrons', () => {
    expect(SIDE_CHEVRON.left).toBe('‹');
    expect(SIDE_CHEVRON.right).toBe('›');
  });
  it('arrows', () => {
    expect(SIDE_ARROW.left).toBe('←');
    expect(SIDE_ARROW.right).toBe('→');
  });
  it('left and right are never the same glyph', () => {
    expect(SIDE_CHEVRON.left).not.toBe(SIDE_CHEVRON.right);
    expect(SIDE_ARROW.left).not.toBe(SIDE_ARROW.right);
  });
});

describe('flex row layout', () => {
  it('an ltr row starts on the left and ends on the right', () => {
    expect(startSide('ltr')).toBe('left');
    expect(endSide('ltr')).toBe('right');
  });
  it('an rtl row starts on the RIGHT and ends on the left', () => {
    // This is the fact the month nav got wrong: dir="rtl" reverses the visual
    // order, so "first child in the DOM" is the right-hand button.
    expect(startSide('rtl')).toBe('right');
    expect(endSide('rtl')).toBe('left');
  });
  it('the two children of a row occupy opposite edges', () => {
    for (const dir of DIRS) {
      expect(flexRowSide(dir, 0)).not.toBe(flexRowSide(dir, 1));
    }
  });

  it('each child gets the chevron pointing at ITS OWN edge, in both directions', () => {
    // The whole contract, stated in CODE POINTS — which is only the same thing as
    // pixels because every consumer isolates the glyph to LTR (see CHEVRON_BIDI).
    // `‹` must never sit on the right edge and `›` never on the left.
    for (const dir of DIRS) {
      for (const index of [0, 1] as const) {
        expect(flexRowChevron(dir, index)).toBe(SIDE_CHEVRON[flexRowSide(dir, index)]);
      }
    }
  });

  it('the month nav is a mirror pair, not the same glyph twice', () => {
    // LTR renders [prev, title, next]; RTL renders [next, title, prev]. Because
    // dir="rtl" flips the visual order, BOTH end up with prev drawn on the visual
    // left and next on the visual right — so the per-branch glyph pairs are
    // mirror images of each other in DOM order.
    expect([flexRowChevron('ltr', 0), flexRowChevron('ltr', 1)]).toEqual(['‹', '›']);
    expect([flexRowChevron('rtl', 0), flexRowChevron('rtl', 1)]).toEqual(['›', '‹']);
  });
});

describe('chevrons must be bidi-isolated', () => {
  it('CHEVRON_BIDI forces an LTR run', () => {
    // U+2039/U+203A are Bidi_Mirrored: measured in Chrome, `‹` PAINTS as `›`
    // inside dir="rtl" and vice versa. Everything else in this file reasons about
    // code points, which is only the same thing as pixels inside an LTR run — so
    // every chevron has to carry this.
    expect(CHEVRON_BIDI).toEqual({ dir: 'ltr' });
  });

  it('every chevron in MonthNav is rendered with it', () => {
    const path = fileURLToPath(new URL('./../app/components/MonthNav.tsx', import.meta.url));
    const src = readFileSync(path, 'utf8');
    const chevronLinks = [...src.matchAll(/<Link[^>]*aria-label="[^"]*(?:month|חודש)[^"]*"[^>]*>/g)].map(m => m[0]);
    expect(chevronLinks, 'expected four month-nav chevron links').toHaveLength(4);
    for (const link of chevronLinks) {
      expect(link, 'a chevron link without CHEVRON_BIDI paints the mirror glyph in RTL')
        .toContain('{...CHEVRON_BIDI}');
    }
  });

  it('the back ARROWS need no isolation — they are not mirrored', () => {
    // Measured the same way: U+2190/U+2192 render unchanged in dir="rtl", which is
    // why backArrow() may be chosen from the language and used bare.
    expect(backArrow('rtl')).toBe('→');
    expect(backArrow('ltr')).toBe('←');
  });
});

describe('backArrow', () => {
  it('points back the way the reader came', () => {
    expect(backArrow('ltr')).toBe('←');
    expect(backArrow('rtl')).toBe('→');
  });
  it('is never the same in both directions', () => {
    expect(backArrow('ltr')).not.toBe(backArrow('rtl'));
  });
});

/**
 * A source guard, in the spirit of the copy guard in `translations.test.ts` (which
 * rejects a translated label that starts or ends with an arrow). The unit tests
 * above only bind the HELPERS; nothing stops the next person typing a literal
 * chevron back into the JSX and re-inverting the nav. So: the direction-sensitive
 * components may not contain an arrow or chevron literal at all — the glyph has to
 * come from `direction.ts`, where its correctness is asserted.
 */
describe('no directional glyph is hard-coded in a direction-sensitive component', () => {
  const GUARDED = [
    'app/components/MonthNav.tsx',
    'app/components/FamilyTreeClient.tsx',
    'app/timeline/page.tsx',
    'app/admin/access/page.tsx',
  ];
  const GLYPHS = /[←→‹›]/;

  /** Strip comments, where these glyphs are legitimately quoted while explaining. */
  function stripComments(src: string): string {
    return src
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // {/* JSX comment */}
      .replace(/\/\*[\s\S]*?\*\//g, '')           // /* block */
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
  }

  for (const rel of GUARDED) {
    it(rel, () => {
      const path = fileURLToPath(new URL(`./../${rel}`, import.meta.url));
      const code = stripComments(readFileSync(path, 'utf8'));
      const offending = code
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => GLYPHS.test(line));
      expect(
        offending.map(([n, line]) => `${rel}:${n}: ${line.trim()}`),
        'use backArrow()/flexRowChevron() from lib/direction.ts instead of a literal glyph'
      ).toEqual([]);
    });
  }

  it('guards files that really exist and really import lib/direction', () => {
    // Guarding a renamed or deleted file silently passes, so pin the list.
    for (const rel of GUARDED) {
      const path = fileURLToPath(new URL(`./../${rel}`, import.meta.url));
      expect(readFileSync(path, 'utf8')).toMatch(/@\/lib\/direction|from '\.\.\/\.\.\/lib\/direction'/);
    }
  });
});
