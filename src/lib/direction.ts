/**
 * Directional glyphs, chosen in JSX from the ACTIVE writing direction.
 *
 * Two separate rules live here, and confusing them is what produces a control
 * that reads as doing the opposite of what it does:
 *
 *  1. **A back-link arrow points where reading STARTS** — `←` in LTR, `→` in RTL.
 *     `invite.back` once shipped a literal `'← '` inside the translated label, so
 *     the Hebrew page's "back to calendar" pointed away from the calendar.
 *     `translations.test.ts` now rejects a label that starts or ends with an
 *     arrow; the arrow belongs here instead.
 *
 *  2. **A prev/next chevron points at the EDGE IT SITS ON** — never at "forward
 *     in time", and never simply mirrored with the language. The month nav is a
 *     `flex` row, and a `dir="rtl"` row starts at the RIGHT, so the first child
 *     in the DOM lands on the right there and on the left in LTR. The Hebrew
 *     grid's nav renders `next` first and the Gregorian grid's renders `prev`
 *     first, so a glyph hard-coded per button is inverted in exactly one of them
 *     — which is what shipped: the right-hand button that advanced a month drew
 *     `‹`, and the left-hand one that went back drew `›`.
 *
 * Ask {@link flexRowChevron} for the glyph by DOM POSITION, not by which way the
 * month is moving, and the two can never disagree again.
 */
import type { Lang } from './translations';

export type Dir = 'ltr' | 'rtl';

/** Which visual edge of its container something sits on. */
export type Side = 'left' | 'right';

/** Writing direction for a UI language. Hebrew is the only RTL language here. */
export function dirForLang(lang: Lang): Dir {
  return lang === 'he' ? 'rtl' : 'ltr';
}

/**
 * The chevron that POINTS AT a given edge — **only inside an LTR bidi context**.
 *
 * ⚠ U+2039/U+203A are `Bidi_Mirrored` characters. Measured in Chrome (rendered
 * pixels, not code points): inside `dir="rtl"`, `‹` DRAWS as `›` and `›` DRAWS as
 * `‹`. So in the Hebrew month nav the source glyph and the painted glyph are
 * opposites, and reasoning about the source alone gets the answer exactly wrong —
 * in both directions. (This is a real trap: an audit that read the DOM text
 * reported the Hebrew nav inverted when the pixels were fine, and "fixing" the
 * code points would have inverted the pixels.)
 *
 * Every consumer therefore renders these inside {@link CHEVRON_BIDI} — `dir="ltr"`,
 * which isolates the run so the glyph is painted as written. With that in place
 * the source says what the reader sees, in both languages.
 *
 * `←`/`→` (U+2190/U+2192) were measured the same way and are NOT mirrored, so
 * {@link SIDE_ARROW} needs no isolation.
 */
export const SIDE_CHEVRON: Record<Side, string> = { left: '‹', right: '›' };

/**
 * The `dir` a chevron must be rendered in for the glyph to be painted as written.
 * Spread onto the element that holds a {@link SIDE_CHEVRON}; see the note above.
 */
export const CHEVRON_BIDI = { dir: 'ltr' } as const;

/** The arrow that points at a given edge (the heavier back-link form). */
export const SIDE_ARROW: Record<Side, string> = { left: '←', right: '→' };

/** The edge a `flex-direction: row` container in `dir` starts laying out from. */
export function startSide(dir: Dir): Side {
  return dir === 'rtl' ? 'right' : 'left';
}

/** The opposite edge — where the last child of such a row lands. */
export function endSide(dir: Dir): Side {
  return dir === 'rtl' ? 'left' : 'right';
}

/**
 * The visual edge the child at `index` of a two-child flex row occupies.
 * `index` is the DOM order, which is NOT the visual order in RTL.
 */
export function flexRowSide(dir: Dir, index: 0 | 1): Side {
  return index === 0 ? startSide(dir) : endSide(dir);
}

/**
 * The chevron for the child at DOM `index` of a two-child flex row: it points at
 * whichever edge that child actually renders on, so position and glyph agree in
 * both directions. This is the whole month-nav contract.
 *
 * Render the result inside {@link CHEVRON_BIDI} — without that isolation the RTL
 * branch paints the mirror of what this returns.
 */
export function flexRowChevron(dir: Dir, index: 0 | 1): string {
  return SIDE_CHEVRON[flexRowSide(dir, index)];
}

/**
 * A "back to …" arrow: it points at the edge reading starts from, i.e. back the
 * way the reader came. `←` in LTR, `→` in RTL.
 */
export function backArrow(dir: Dir): string {
  return SIDE_ARROW[startSide(dir)];
}
