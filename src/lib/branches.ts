/**
 * Family branches — the "sides" your tree is made of — and the colours that
 * distinguish them.
 *
 * ── THE BRANCH LIST IS CONFIGURATION, NOT CODE ──
 * Set `FAMILY_BRANCHES` in the environment to a comma-separated list of your own
 * branch names; leave it unset to get the fictional demo family below. Nothing
 * in `src/` needs editing to run this app for a different family.
 *
 * ── ORDER IS LOAD-BEARING ──
 * Colours are assigned by POSITION, not by name:
 *
 *   position 0, 1, 2, 3 …  →  BRANCH_STYLES[position]
 *   the LAST position      →  NEUTRAL_BRANCH_STYLE (the catch-all bucket)
 *   anything not in the list →  NEUTRAL_BRANCH_STYLE
 *
 * So reordering `FAMILY_BRANCHES` reshuffles the colours every family member
 * already recognises. Append; never insert or reorder. And keep a catch-all
 * ("Other", or your word for it) LAST: that position is the one the app treats
 * as "no particular branch" — it is excluded from the surname-spelling UI (it
 * has no surname to spell) and is where the bulk importer files anyone it can't
 * place.
 *
 * ── UNKNOWN VALUES NEVER CRASH ──
 * `family_branch` is a plain TEXT column, so a database can hold values that are
 * not in the configured list — rows written before the list changed, or by an
 * older deployment. Those render with the neutral treatment and are shown
 * verbatim wherever a branch name is displayed. Nothing narrows on the value.
 *
 * This module is PURE and safe to import from client components. The
 * environment read lives in `branches-server.ts`; the browser gets the resolved
 * list as a prop, through `UserPrefsProvider`.
 */

/**
 * The built-in list, used whenever `FAMILY_BRANCHES` is unset. Placeholder
 * surnames for a fictional demo family — see `scripts/seed-example-family.ts`,
 * which seeds people into these branches.
 */
export const DEFAULT_FAMILY_BRANCHES: readonly string[] = [
  'Levi',
  'Cohen',
  'Mizrahi',
  'Adler',
  'Other',
];

/**
 * Parse a `FAMILY_BRANCHES` value: comma-separated, whitespace trimmed, blanks
 * dropped, duplicates collapsed (keeping the first occurrence, so positions —
 * and therefore colours — stay put). Unset, empty or all-blank falls back to
 * {@link DEFAULT_FAMILY_BRANCHES}, so a zero-config deployment just works.
 */
export function parseBranchList(raw: string | null | undefined): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const deduped = [...new Set(parsed)];
  return deduped.length > 0 ? deduped : [...DEFAULT_FAMILY_BRANCHES];
}

/**
 * The catch-all bucket: the LAST configured branch. `null` for an empty list.
 * This is the branch that means "not one of the named sides" — it gets the
 * neutral colour and is kept out of the spelling UI.
 */
export function catchAllBranch(branches: readonly string[]): string | null {
  return branches.length > 0 ? branches[branches.length - 1] : null;
}

/**
 * Every branch EXCEPT the catch-all — the ones that name an actual surname, and
 * so can carry alternate spellings.
 */
export function namedBranches(branches: readonly string[]): string[] {
  return branches.slice(0, -1);
}

/** True when `branch` is the catch-all (or is unset / unrecognised). */
export function isCatchAllBranch(
  branches: readonly string[],
  branch: string | null | undefined
): boolean {
  return branchSlot(branches, branch) < 0;
}

/**
 * The palette slot a branch value occupies, or -1 for "no slot" — meaning the
 * neutral treatment. -1 covers all three ways a person can lack a branch
 * colour: no value at all, the catch-all last position, and a value the current
 * configuration does not know about.
 */
export function branchSlot(
  branches: readonly string[],
  branch: string | null | undefined
): number {
  if (!branch) return -1;
  const i = branches.indexOf(branch);
  if (i < 0) return -1;                     // legacy / foreign value in the DB
  if (i === branches.length - 1) return -1; // the catch-all bucket
  return i;
}

/**
 * Which branch a person is filed under for filtering purposes: their own branch
 * value, or the catch-all when that value is unset, is itself the catch-all, or
 * is not in the configured list. Keeps the tree's branch filter consistent with
 * the colours — anything painted neutral filters under the neutral chip.
 */
export function branchBucket(
  branches: readonly string[],
  branch: string | null | undefined
): string | null {
  return branchSlot(branches, branch) < 0 ? catchAllBranch(branches) : branch!;
}

/** Every way the app tints a branch, resolved together so they cannot drift. */
export interface BranchStyle {
  /** Avatar chip background (Tailwind utility). */
  bg: string;
  /** Avatar chip initials colour (Tailwind utility). */
  fg: string;
  /** Legend / spelling-modal dot background (Tailwind utility). */
  dot: string;
  /** Raw hex, for SVG strokes and inline styles. */
  accent: string;
  /** Timeline card inline-start border colour (Tailwind utility). */
  border: string;
}

/**
 * Desaturated paper tints — they gently distinguish branches without leaving the
 * restrained bone/olive palette. Indexed by branch POSITION (see the header):
 * slot 0 is the first configured branch, and so on. Add more entries to support
 * families with more than four named branches; positions beyond the end of this
 * table wrap around.
 */
export const BRANCH_STYLES: readonly BranchStyle[] = [
  { bg: 'bg-[#E4E3D2]', fg: 'text-[#4C4F30]', dot: 'bg-[#4C4F30]', accent: '#4C4F30', border: 'border-s-[#4C4F30]' },
  { bg: 'bg-[#DCE3DD]', fg: 'text-[#3C4A3E]', dot: 'bg-[#3C4A3E]', accent: '#3C4A3E', border: 'border-s-[#3C4A3E]' },
  { bg: 'bg-[#E9DBD3]', fg: 'text-[#6B4A3E]', dot: 'bg-[#6B4A3E]', accent: '#6B4A3E', border: 'border-s-[#6B4A3E]' },
  { bg: 'bg-[#ECE3CE]', fg: 'text-[#6B5A2E]', dot: 'bg-[#6B5A2E]', accent: '#6B5A2E', border: 'border-s-[#6B5A2E]' },
];

/** The catch-all / unknown-branch treatment: present, but deliberately quiet. */
export const NEUTRAL_BRANCH_STYLE: BranchStyle = {
  bg: 'bg-parchment-dark',
  fg: 'text-ink-muted',
  dot: 'bg-ink-faint',
  accent: '#B6BCC6',
  border: 'border-s-warm-border',
};

/**
 * The colours for one person's branch. Total: any string (or null) resolves,
 * because an unrecognised value is a normal thing to find in the database.
 */
export function branchStyle(
  branches: readonly string[],
  branch: string | null | undefined
): BranchStyle {
  const slot = branchSlot(branches, branch);
  if (slot < 0) return NEUTRAL_BRANCH_STYLE;
  return BRANCH_STYLES[slot % BRANCH_STYLES.length];
}
