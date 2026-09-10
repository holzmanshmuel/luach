'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { isUndefinedColumn, setFamilyBranches, validateBranchList } from '@/lib/branches-server';

/**
 * Replace the active family's branch list with `next`, in order.
 *
 * Owner-only, verified live (`requireAdmin`) — the proxy's `/admin/*` gate is a
 * cookie hint, not authorization. The write itself can only ever touch the
 * family this request has entered: `setFamilyBranches()` selects its row by the
 * tenant GUC, not by an id anyone can pass. See branches-server.ts.
 *
 * The WHOLE ordered list is sent every time, deliberately: a branch's colour is
 * its position, so "add", "rename" and "make this the catch-all" are all the same
 * operation — write the new order — and there is no way for two edits to leave a
 * gap or a shifted position behind.
 */
export async function saveBranchesAction(
  next: string[]
): Promise<{ error?: string; branches?: string[] }> {
  try {
    await requireAdmin();
  } catch {
    return { error: 'Admin access required.' };
  }

  // Validate before writing so the owner gets the reason in words. Not for
  // safety — setFamilyBranches() re-checks and the DB has a shape constraint.
  const checked = validateBranchList(next);
  if ('error' in checked) return { error: checked.error };

  let branches: string[];
  try {
    branches = await setFamilyBranches(checked.branches);
  } catch (err) {
    // The READ tolerates a database that predates migrate-v14 by falling back to
    // the deployment's list, so this page renders and is usable before the
    // migration has been run. The WRITE cannot fall back — there is nowhere to
    // put the list — so say that in words instead of throwing a 500 at someone
    // who has just spent a minute typing their family's surnames.
    if (isUndefinedColumn(err)) {
      return {
        error:
          'This calendar\'s database has not been updated for per-family branches yet, ' +
          'so the list cannot be saved. Nothing was lost — whoever runs this Luach needs ' +
          'to apply the pending database migration, then this page will work.',
      };
    }
    throw err;
  }

  // Branch colours and chips appear on every surface, and the branch list also
  // gates which branches can carry alternate spellings.
  revalidatePath('/', 'layout');
  return { branches };
}
