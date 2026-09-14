'use server';

import { revalidatePath } from 'next/cache';
import { withAdminOrError } from '@/lib/auth';
import { isUndefinedColumn, setFamilyBranches, validateBranchList } from '@/lib/branches-server';
import { keyedDenial } from '@/lib/action-errors';
import type { TMessage } from '@/lib/translations';

type SaveBranchesResult = { error?: TMessage; branches?: string[] };

/**
 * Replace the active family's branch list with `next`, in order.
 *
 * Owner-only, verified live (`withAdminOrError`) — the proxy's `/admin/*` gate is
 * a cookie hint, not authorization. The write itself can only ever touch the
 * family this request has entered: `setFamilyBranches()` selects its row by the
 * tenant GUC, not by an id anyone can pass. See branches-server.ts.
 *
 * The whole body runs inside the wrapper's `runWithTenant()` callback, because
 * `setFamilyBranches()` is a tenant-scoped query() and a bare `await
 * requireAdmin()` does not leave a tenant behind in a Server Action — see the note
 * in lib/auth.ts.
 *
 * The WHOLE ordered list is sent every time, deliberately: a branch's colour is
 * its position, so "add", "rename" and "make this the catch-all" are all the same
 * operation — write the new order — and there is no way for two edits to leave a
 * gap or a shifted position behind.
 *
 * Errors are translation keys with their data (`TMessage`), never English text —
 * the page is bilingual and the client renders them in the owner's language.
 */
export async function saveBranchesAction(next: string[]): Promise<SaveBranchesResult> {
  return keyedDenial(await withAdminOrError(async (): Promise<SaveBranchesResult> => {
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
        return { error: { key: 'branches.err.not_migrated' } };
      }
      throw err;
    }

    // Branch colours and chips appear on every surface, and the branch list also
    // gates which branches can carry alternate spellings.
    revalidatePath('/', 'layout');
    return { branches };
  }));
}
