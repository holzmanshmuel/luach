import { runWithTenant } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser, type Membership } from '@/lib/users';
import { familyColorAt } from '@/lib/family-color';
import type { FamilyTag } from '@/lib/types';

/** Ordered, deduped, member-only subset of client-supplied ids. Never trusts the input. */
export function filterToMemberships(candidateIds: number[], memberships: Membership[]): number[] {
  const members = new Set(memberships.map(m => m.family_id));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of candidateIds) {
    if (members.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export type ViewResolution =
  | { mode: 'single'; homeFamilyId: number }
  | { mode: 'combined'; homeFamilyId: number; families: FamilyTag[] };

/** Stable color per family: assigned by family_id ascending across ALL the user's memberships. */
function colorMap(memberships: Membership[]): Map<number, string> {
  const sorted = [...memberships].sort((a, b) => a.family_id - b.family_id);
  const m = new Map<number, string>();
  sorted.forEach((mem, i) => m.set(mem.family_id, familyColorAt(i)));
  return m;
}

export function computeViewFamilies(
  candidateIds: number[],
  memberships: Membership[],
  homeFamilyId: number,
): ViewResolution {
  const valid = filterToMemberships(candidateIds, memberships);
  if (valid.length < 2) return { mode: 'single', homeFamilyId };
  const colors = colorMap(memberships);
  const byId = new Map(memberships.map(m => [m.family_id, m]));
  const families: FamilyTag[] = valid.map(id => {
    const mem = byId.get(id)!;
    return { id, name: mem.family_name, nameHe: mem.family_name_he ?? null, color: colors.get(id)! };
  });
  return { mode: 'combined', homeFamilyId, families };
}

/** Session shell: resolves the display mode + validated families from the session. */
export async function resolveViewFamilies(): Promise<ViewResolution | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return null;
  const memberships = await getMembershipsForUser(session.userId);
  return computeViewFamilies(session.viewFamilyIds ?? [], memberships, session.familyId);
}

export function tagWith<F extends { id: number }>(family: F) {
  return <T>(item: T): T & { family: F } => ({ ...item, family });
}

/**
 * Run `fn` inside EACH family's own tenant context, concurrently. Isolation-critical:
 * each runWithTenant establishes a distinct AsyncLocalStorage store that survives awaits,
 * and db.query() captures the family synchronously + uses a dedicated connection with a
 * transaction-local GUC — so parallel calls cannot bleed. Proven by combined.test.ts.
 */
export function mapAcrossFamilies<T>(
  families: FamilyTag[],
  fn: (family: FamilyTag) => Promise<T>,
): Promise<T[]> {
  return Promise.all(families.map(fam => runWithTenant(fam.id, () => fn(fam))));
}

/** Convenience for a single list: fetch per family, tag each item, flatten. */
export async function aggregateAcrossFamilies<T>(
  families: FamilyTag[],
  fetch: () => Promise<T[]>,
): Promise<Array<T & { family: FamilyTag }>> {
  const perFamily = await mapAcrossFamilies(families, async (fam) =>
    (await fetch()).map(tagWith(fam)));
  return perFamily.flat();
}
