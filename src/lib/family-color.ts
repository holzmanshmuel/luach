/**
 * Per-family accent colors for the combined (merged) multi-family view. Shown ONLY
 * as a stripe/dot (never as text color or a large fill), so contrast stays safe and
 * these read distinctly from the pale event-type tints (amber/sky/rose/taupe/violet)
 * and the green gathering tint. Assigned by a family's stable position in the user's
 * membership list, so a family keeps its color and new families don't reshuffle.
 */
export type FamilyColor = string;

export const FAMILY_PALETTE: FamilyColor[] = [
  '#4F46E5', // indigo
  '#0D9488', // teal
  '#E11D48', // crimson
  '#D97706', // amber-600
  '#7C3AED', // violet
  '#059669', // emerald
  '#2563EB', // blue
  '#DB2777', // pink
];

export function familyColorAt(index: number): FamilyColor {
  return FAMILY_PALETTE[((index % FAMILY_PALETTE.length) + FAMILY_PALETTE.length) % FAMILY_PALETTE.length];
}
