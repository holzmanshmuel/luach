import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { familyBranches } from '@/lib/branches-server';
import {
  ViewerSpelling,
  buildVariants,
  makeViewerSpelling,
} from '@/lib/spelling-core';

export { rewriteNames } from '@/lib/spelling-core';
export type { ViewerSpelling } from '@/lib/spelling-core';

export const SPELLINGS_COOKIE = 'name_spellings';

/**
 * branch -> accepted spellings (branch value first). Cached per request so the
 * many loaders that rewrite names share a single DB read.
 */
export const loadBranchVariants = cache(async (): Promise<Record<string, string[]>> => {
  const [rows, branches] = await Promise.all([
    query<{ branch: string; spelling: string }>(
      `SELECT branch, spelling FROM family_calendar.branch_spellings`
    ),
    // The ACTIVE family's list — resolved from its own row, then FAMILY_BRANCHES.
    // Callers have already established tenant context (this runs a scoped query()
    // of its own, which throws without one).
    familyBranches(),
  ]);
  return buildVariants(branches, rows);
});

function readChosen(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The viewer's spelling, resolved once per request. */
export const getViewerSpelling = cache(async (): Promise<ViewerSpelling> => {
  const [variants, cookieStore] = await Promise.all([loadBranchVariants(), cookies()]);
  const chosen = readChosen(cookieStore.get(SPELLINGS_COOKIE)?.value);
  return makeViewerSpelling(variants, chosen);
});
