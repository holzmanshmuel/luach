export const dynamic = 'force-dynamic';

import { loadFamilyTree, loadUnlinkedMembers } from '@/lib/tree';
import { getBranchSpellings } from '@/app/actions';
import { FamilyTreeClient } from '@/app/components/FamilyTreeClient';
import { requireAuth } from '@/lib/auth';

export default async function TreePage() {
  // Establish tenant context up front. loadFamilyTree/loadUnlinkedMembers call a
  // bare query() with no guard of their own, and even getBranchSpellings' internal
  // requireAuth wouldn't cover its Promise.all siblings (enterWith doesn't cross
  // sibling promises), so the guard must run here, awaited, before the fan-out.
  await requireAuth();

  const [roots, unlinked, spellings] = await Promise.all([
    loadFamilyTree(),
    loadUnlinkedMembers(),
    getBranchSpellings(),
  ]);

  return (
    <div className="min-h-screen bg-parchment">
      <FamilyTreeClient roots={roots} unlinked={unlinked} spellings={spellings} />
    </div>
  );
}
