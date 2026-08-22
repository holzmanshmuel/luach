import { query } from '@/lib/db';
import { FamilyMember, FamilyTreeNode } from '@/lib/types';
import { getViewerSpelling, rewriteNames } from '@/lib/spellings';

export interface RawRelationship {
  person_id: number;
  related_to: number;
  relation: 'parent' | 'spouse';
}

export interface RawBirthday {
  family_member_id: number;
  hebrew_day: number;
  hebrew_month: string;
  gregorian_year: number | null;
  original_english_date: string | null;
}

/**
 * Build a tree rooted at the given person ID.
 * Spouse relationships make the spouse a sibling node to the person (same level).
 * Parent relationships create child nodes.
 */
function toNode(id: number, members: Map<number, FamilyMember>, birthdays: Map<number, RawBirthday>): FamilyTreeNode | null {
  const m = members.get(id);
  if (!m) return null;
  const bd = birthdays.get(id);
  return {
    id,
    name: m.name,
    last_name: m.last_name ?? null,
    name_he: m.name_he ?? null,
    maiden_name: m.maiden_name ?? null,
    maiden_name_he: m.maiden_name_he ?? null,
    nickname: m.nickname ?? null,
    family_branch: m.family_branch as FamilyTreeNode['family_branch'],
    photo_url: m.photo_url ?? null,
    children: [],
    birthday: bd ? { hebrew_day: bd.hebrew_day, hebrew_month: bd.hebrew_month, gregorian_year: bd.gregorian_year } : undefined,
  };
}

function buildNode(
  id: number,
  members: Map<number, FamilyMember>,
  parentMap: Map<number, number[]>,   // person_id -> [child_ids]
  spouseMap: Map<number, number[]>,   // person_id -> [spouse_ids] (remarriage → many)
  birthdays: Map<number, RawBirthday>,
  visited: Set<number>
): FamilyTreeNode | null {
  if (visited.has(id)) return null;
  visited.add(id);

  const node = toNode(id, members, birthdays);
  if (!node) return null;

  // Attach every spouse (remarriage). Each partner is claimed once via `visited`.
  const allSpouseIds = spouseMap.get(id) ?? [];
  const spouseIds = allSpouseIds.filter(sid => !visited.has(sid));
  const spouses: FamilyTreeNode[] = [];
  for (const sid of spouseIds) {
    visited.add(sid);
    const s = toNode(sid, members, birthdays);
    if (s) spouses.push(s);
  }
  if (spouses.length > 0) {
    node.spouses = spouses;
    node.spouse = spouses[0]; // back-compat
  }
  // A spouse already placed elsewhere (a blood relative married in — cousin
  // marriage) can't get a second card; record a reference so the marriage still
  // shows as a "⚭ name" chip rather than disappearing.
  const refs = allSpouseIds
    .filter(sid => !spouseIds.includes(sid))
    .map(sid => ({ id: sid, name: members.get(sid)?.name ?? '' }))
    .filter(r => r.name);
  if (refs.length > 0) node.spouseRefs = refs;

  // Attach children of the person AND any of their spouses, sorted oldest-first.
  const childIds = new Set<number>();
  for (const parentId of [id, ...spouseIds]) {
    for (const childId of parentMap.get(parentId) ?? []) {
      childIds.add(childId);
    }
  }

  function getBirthSortKey(bd: RawBirthday | undefined): number {
    if (bd?.original_english_date) {
      return new Date(bd.original_english_date + 'T12:00:00Z').getTime();
    }
    // Normalise a year-only birth to the same epoch-ms scale as full dates,
    // otherwise `year * 10000` (~20k) sorts every year-only child before every
    // full-date child (which are ~1e12), making them all appear oldest.
    if (bd?.gregorian_year) return Date.UTC(bd.gregorian_year, 0, 1);
    return Infinity;
  }

  const sortedChildIds = [...childIds].sort(
    (a, b) => getBirthSortKey(birthdays.get(a)) - getBirthSortKey(birthdays.get(b))
  );

  for (const childId of sortedChildIds) {
    const childNode = buildNode(childId, members, parentMap, spouseMap, birthdays, visited);
    if (childNode) node.children.push(childNode);
  }

  return node;
}

/**
 * Load the full family tree from the database.
 * Returns an array of root nodes (people with no parents in the relationships table).
 */
export async function loadFamilyTree(): Promise<FamilyTreeNode[]> {
  const [membersRows, relationships, birthdayRows, vs] = await Promise.all([
    query<FamilyMember>('SELECT * FROM family_calendar.family_members'),
    query<RawRelationship>('SELECT * FROM family_calendar.relationships ORDER BY id'),
    query<RawBirthday>(
      `SELECT family_member_id, hebrew_day, hebrew_month, gregorian_year, original_english_date
       FROM family_calendar.events WHERE event_type = 'birthday'`
    ),
    getViewerSpelling(),
  ]);

  // Apply the viewer's chosen surname spelling before the names get baked into nodes.
  rewriteNames(membersRows, vs);

  return buildForest(membersRows, relationships, birthdayRows);
}

/**
 * Pure forest builder (no DB), split out so the root-detection logic can be
 * unit-tested. Returns the top-level root nodes for the given graph.
 */
export function buildForest(
  membersRows: FamilyMember[],
  relationships: RawRelationship[],
  birthdayRows: RawBirthday[],
): FamilyTreeNode[] {
  const members = new Map(membersRows.map(m => [m.id, m]));
  const birthdays = new Map(birthdayRows.map(b => [b.family_member_id, b]));

  // Build parent map: parent_id -> [child_ids]
  const parentMap = new Map<number, number[]>();
  // Track which people have a parent (so we can find roots)
  const hasParent = new Set<number>();
  // person_id -> [spouse_ids]. One-to-many so a remarriage keeps BOTH partners
  // (spouse rows are stored bidirectionally; dedupe per person).
  const spouseMap = new Map<number, number[]>();
  const addSpouse = (a: number, b: number) => {
    const list = spouseMap.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    spouseMap.set(a, list);
  };

  for (const rel of relationships) {
    if (rel.relation === 'parent') {
      const children = parentMap.get(rel.person_id) ?? [];
      children.push(rel.related_to);
      parentMap.set(rel.person_id, children);
      hasParent.add(rel.related_to);
    } else if (rel.relation === 'spouse') {
      addSpouse(rel.person_id, rel.related_to);
      addSpouse(rel.related_to, rel.person_id);
    }
  }

  // People who appear in relationships but have no parent = potential roots
  // Also people who have NO relationships at all are shown separately
  const visited = new Set<number>();
  const roots: FamilyTreeNode[] = [];

  // First: find people in the relationship graph who have no parent
  const inRelationships = new Set<number>([
    ...relationships.map(r => r.person_id),
    ...relationships.map(r => r.related_to),
  ]);

  // Determine the top-level roots. A couple is the unit: a parentless person is a
  // root UNLESS they "married in" — i.e. their spouse has a parent in the tree, in
  // which case they're attached under that spouse (as node.spouse) rather than
  // standing as their own root. For a top couple where neither has a parent, the
  // first one reached becomes the root and attaches the other via node.spouse; the
  // shared `visited` set then prevents the partner from being emitted a second time.
  // (Spouse links are stored bidirectionally, so map direction can't be relied on.)
  for (const id of inRelationships) {
    if (visited.has(id)) continue;          // already placed (e.g. as a root's spouse)
    if (hasParent.has(id)) continue;        // children are never roots
    // Married into the family: a spouse of theirs has a parent in the tree, so
    // they attach under that spouse rather than standing as their own root.
    if ((spouseMap.get(id) ?? []).some(sid => hasParent.has(sid))) continue;
    const node = buildNode(id, members, parentMap, spouseMap, birthdays, visited);
    if (node) roots.push(node);
  }

  // Safety net: anyone in the relationship graph who wasn't placed by the couple/
  // root logic above still gets emitted, so they never SILENTLY VANISH from the
  // tree. This catches a dropped second spouse (remarriage — the single-spouse
  // model can only attach one partner), a cousin-marriage edge, and a branch
  // orphaned by a bad parent link. They render as their own node rather than
  // disappearing; `visited` keeps anyone already shown from doubling.
  for (const id of inRelationships) {
    if (visited.has(id)) continue;
    const node = buildNode(id, members, parentMap, spouseMap, birthdays, visited);
    if (node) roots.push(node);
  }

  return roots;
}

/**
 * Load people who have no relationships at all — shown as an "unlinked" section.
 */
export async function loadUnlinkedMembers(): Promise<FamilyMember[]> {
  const [rows, vs] = await Promise.all([
    query<FamilyMember>(`
      SELECT fm.* FROM family_calendar.family_members fm
      WHERE fm.id NOT IN (
        SELECT DISTINCT person_id FROM family_calendar.relationships
        UNION
        SELECT DISTINCT related_to FROM family_calendar.relationships
      )
      ORDER BY fm.family_branch, fm.last_name NULLS LAST, fm.name
    `),
    getViewerSpelling(),
  ]);
  return rewriteNames(rows, vs);
}
