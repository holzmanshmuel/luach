import { branchStyle, catchAllBranch } from '@/lib/branches';

/**
 * The pure core behind `/admin/branches`: given the family's SAVED branch list,
 * the DRAFT the owner is editing, and how many people are filed under each stored
 * branch value, say what saving would cost — in the owner's terms, not the
 * schema's.
 *
 * Split out of `BranchesPanel.tsx` so it is testable without rendering (same
 * shape as `spelling-core.ts` next door). PURE: no DB, no environment, no React.
 */

/** One thing the owner should know before saving. `caution` = someone will notice. */
export interface BranchDraftWarning {
  tone: 'caution' | 'info';
  text: string;
}

/**
 * Ordered most-alarming first.
 *
 * The colour warning compares each surviving branch's RESOLVED STYLE between the
 * two lists rather than its index. That is the question the owner actually has —
 * "does this change a colour someone recognises?" — and index arithmetic gets it
 * wrong in exactly the case that matters most: appending a branch shifts the
 * catch-all's index by one, but the catch-all is neutral at ANY index, so nothing
 * changes colour and the safe edit must not raise an alarm.
 */
export function computeBranchWarnings(
  saved: readonly string[],
  draft: readonly string[],
  counts: Record<string, number>
): BranchDraftWarning[] {
  const out: BranchDraftWarning[] = [];
  const trimmed = draft.map(s => (s ?? '').trim());

  // 1. People stranded by a removal or a rename. `family_members.family_branch`
  //    is free TEXT with no foreign key, so nothing cascades — those rows keep a
  //    value the list no longer has, and render neutral.
  const stranded = Object.keys(counts)
    .filter(value => (counts[value] ?? 0) > 0)
    .filter(value => saved.includes(value) && !trimmed.includes(value))
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  for (const value of stranded) {
    const n = counts[value] ?? 0;
    out.push({
      tone: 'caution',
      text: `${n} ${n === 1 ? 'person is' : 'people are'} filed under "${value}", which this draft no longer lists. `
        + `Nothing breaks, but they will show in plain grey and filter under the catch-all until you `
        + `re-file them one by one in the tree.`,
    });
  }

  // 2. Branches whose colour changes hands.
  const recoloured = trimmed.filter(
    name => saved.includes(name) && branchStyle(saved, name) !== branchStyle(trimmed, name)
  );
  if (recoloured.length > 0) {
    out.push({
      tone: 'caution',
      text: `This changes the colour of ${recoloured.length === 1 ? '1 branch' : `${recoloured.length} branches`}: `
        + `${recoloured.join(', ')}. Everyone in your family has to relearn them. Adding a branch at the `
        + `bottom of the list avoids this entirely.`,
    });
  }

  // 3. The catch-all changed hands — the reorder that is easiest to do by accident.
  const before = catchAllBranch(saved);
  const after = catchAllBranch(trimmed);
  if (before && after && before !== after && trimmed.includes(before)) {
    out.push({
      tone: 'info',
      text: `"${after}" becomes the catch-all, so it loses its colour; "${before}" stops being the `
        + `catch-all and picks one up.`,
    });
  }

  // 4. Renames, for confirmation rather than alarm. Only claimed for an in-place
  //    edit (same length, same slot) — once entries are added or removed, "an add
  //    plus a remove" is indistinguishable from a rename and guessing would lie.
  const renamed = saved.length === trimmed.length
    ? trimmed.filter((name, i) => saved[i] !== name && !saved.includes(name)).length
    : 0;
  if (renamed > 0 && stranded.length === 0) {
    out.push({
      tone: 'info',
      text: `${renamed === 1 ? '1 branch is' : `${renamed} branches are`} renamed in place — `
        + `${renamed === 1 ? 'it keeps its' : 'they keep their'} colour, and nobody is currently filed `
        + `under the old ${renamed === 1 ? 'name' : 'names'}.`,
    });
  }

  return out;
}
