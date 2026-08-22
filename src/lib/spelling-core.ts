/**
 * Pure (no DB / no cookies) core of the per-viewer family-name spelling feature,
 * split out so the name-rewriting logic can be unit-tested. See spellings.ts for
 * the server wiring (DB load + cookie read).
 *
 * Every spelling of a branch surname is equal — there is no "main" one. Each
 * branch (keyed by its family_branch value) has a set of spellings: the branch
 * value itself plus any added in the app. A viewer chooses one per branch, and
 * names + branch tags render in that spelling.
 */

export interface ViewerSpelling {
  variants: Record<string, string[]>;
  chosen: Record<string, string>;
  spell(branch: string | null | undefined): string | null;
  applyToName(name: string, branch: string | null | undefined): string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}

/**
 * branch -> accepted spellings, the branch value first. `branches` are the
 * canonical family_branch values (each becomes its own first spelling); `rows`
 * are the added variants from the app.
 */
export function buildVariants(
  branches: readonly string[],
  rows: { branch: string; spelling: string }[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const b of branches) if (b !== 'Other') map[b] = [b];
  for (const r of rows) {
    (map[r.branch] ??= [r.branch]);
    if (!map[r.branch].includes(r.spelling)) map[r.branch].push(r.spelling);
  }
  return map;
}

export function makeViewerSpelling(
  variants: Record<string, string[]>,
  chosen: Record<string, string>
): ViewerSpelling {
  const spell = (branch: string | null | undefined): string | null => {
    if (!branch) return branch ?? null;
    const opts = variants[branch] ?? [branch];
    const pick = chosen[branch];
    return pick && opts.includes(pick) ? pick : (opts[0] ?? branch);
  };

  const applyToName = (name: string, branch: string | null | undefined): string => {
    if (!name || !branch) return name;
    const opts = variants[branch] ?? [branch];
    // Only rewrite when the viewer has EXPLICITLY chosen a spelling. With no
    // choice, names are shown exactly as stored — so adding a variant never
    // silently normalizes everyone's name.
    const pick = chosen[branch];
    const target = pick && opts.includes(pick) ? pick : null;
    if (!target) return name;
    const targetHe = isHebrew(target);
    let out = name;
    for (const v of opts) {
      if (v === target || isHebrew(v) !== targetHe) continue;
      const re = new RegExp(`(^|[^\\p{L}])(${escapeRegex(v)})(?=[^\\p{L}]|$)`, 'giu');
      out = out.replace(re, (_m, pre) => pre + target);
    }
    return out;
  };

  return { variants, chosen, spell, applyToName };
}

/** Rewrite name / last_name / name_he on a batch of rows in place, by branch.
 *  With a dedicated surname, the viewer's chosen spelling now targets last_name
 *  directly (cleaner than substring-matching within the full name), and still
 *  applies to name/name_he for legacy not-yet-split rows. */
export function rewriteNames<
  T extends { name?: string; last_name?: string | null; name_he?: string | null; family_branch?: string | null }
>(rows: T[], vs: ViewerSpelling): T[] {
  for (const r of rows) {
    const branch = r.family_branch ?? null;
    if (r.name) r.name = vs.applyToName(r.name, branch);
    if (r.last_name) r.last_name = vs.applyToName(r.last_name, branch);
    if (r.name_he) r.name_he = vs.applyToName(r.name_he, branch);
  }
  return rows;
}
