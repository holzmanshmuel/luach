'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { setFamilyBranches, validateBranchList } from '@/lib/branches-server';

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

  const branches = await setFamilyBranches(checked.branches);

  // Branch colours and chips appear on every surface, and the branch list also
  // gates which branches can carry alternate spellings.
  revalidatePath('/', 'layout');
  return { branches };
}
