import { describe, it, expect } from 'vitest';
import { buildForest, type RawRelationship, type RawBirthday } from './tree';
import type { FamilyMember, FamilyTreeNode } from './types';

// Minimal member factory.
const member = (id: number, name: string): FamilyMember => ({
  id, name, name_he: null, name_he_status: null, maiden_name: null, maiden_name_he: null,
  nickname: null, family_branch: null, photo_url: null, phone_e164: null,
  notifications_enabled: true, created_at: '', updated_at: '',
});

// Spouse links are stored bidirectionally by the app (A→B and B→A).
const spousePair = (a: number, b: number): RawRelationship[] => [
  { person_id: a, related_to: b, relation: 'spouse' },
  { person_id: b, related_to: a, relation: 'spouse' },
];
const parentOf = (parent: number, child: number): RawRelationship => ({
  person_id: parent, related_to: child, relation: 'parent',
});

const ids = (nodes: FamilyTreeNode[]): number[] => nodes.map(n => n.id);
function allIds(nodes: FamilyTreeNode[]): number[] {
  const out: number[] = [];
  const walk = (n: FamilyTreeNode) => {
    out.push(n.id);
    for (const s of n.spouses ?? []) out.push(s.id);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

const NO_BD: RawBirthday[] = [];

describe('buildForest — root detection (C2 / H1)', () => {
  it('emits a single root for a top couple stored bidirectionally (not zero, not two)', () => {
    const members = [member(1, 'Grandma'), member(2, 'Grandpa')];
    const roots = buildForest(members, spousePair(1, 2), NO_BD);
    expect(roots).toHaveLength(1);
    expect(roots[0].spouse?.id).toBeDefined();
    // Both partners are present exactly once across the forest.
    expect(allIds(roots).sort()).toEqual([1, 2]);
  });

  it('does not make a married-in spouse (no parent) a second root', () => {
    // Grandma+Grandpa are the top couple; their child C marries S (who has no parent).
    const members = [1, 2, 3, 4].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [
      ...spousePair(1, 2),
      parentOf(1, 3), parentOf(2, 3), // 3 is child of the top couple
      ...spousePair(3, 4),            // 4 married into the family
    ];
    const roots = buildForest(members, rels, NO_BD);
    expect(roots).toHaveLength(1);           // only the top couple's root
    // Everyone appears exactly once, no duplicates, nobody dropped.
    expect(allIds(roots).sort()).toEqual([1, 2, 3, 4]);
    // The married-in spouse hangs under the child, not at the top.
    expect(ids(roots)).not.toContain(4);
  });

  it('children are not stolen from their parent or duplicated at the top', () => {
    const members = [1, 2, 3].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [...spousePair(1, 2), parentOf(1, 3), parentOf(2, 3)];
    const roots = buildForest(members, rels, NO_BD);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map(c => c.id)).toEqual([3]);
    // No duplicate ids anywhere.
    const flat = allIds(roots);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('orders children oldest-first by birth date', () => {
    const members = [1, 2, 3, 4].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [
      ...spousePair(1, 2), parentOf(1, 3), parentOf(1, 4),
    ];
    const birthdays: RawBirthday[] = [
      { family_member_id: 4, hebrew_day: 1, hebrew_month: 'Nisan', gregorian_year: 1980, original_english_date: '1980-01-01' },
      { family_member_id: 3, hebrew_day: 1, hebrew_month: 'Nisan', gregorian_year: 1985, original_english_date: '1985-01-01' },
    ];
    const roots = buildForest(members, rels, birthdays);
    expect(roots[0].children.map(c => c.id)).toEqual([4, 3]); // 1980 before 1985
  });

  it('treats a parentless person with no spouse as their own root', () => {
    const members = [member(1, 'Solo'), member(2, 'Child')];
    const roots = buildForest(members, [parentOf(1, 2)], NO_BD);
    expect(ids(roots)).toEqual([1]);
    expect(roots[0].children.map(c => c.id)).toEqual([2]);
  });

  it('attaches BOTH spouses of a remarried person (no one vanishes or duplicates)', () => {
    // Grandpa (1) married to wife1 (2) and wife2 (3), both stored bidirectionally.
    const members = [1, 2, 3].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [...spousePair(1, 2), ...spousePair(1, 3)];
    const roots = buildForest(members, rels, NO_BD);
    expect(roots).toHaveLength(1);
    expect(roots[0].spouses?.map(s => s.id).sort()).toEqual([2, 3]); // both partners attached
    const flat = allIds(roots);
    expect(new Set(flat).size).toBe(flat.length);    // no duplicates
    expect(new Set(flat)).toEqual(new Set([1, 2, 3]));
  });

  it('gathers children from all of a remarried person’s marriages', () => {
    // Person 1 + spouse 2 have child 4; person 1 + spouse 3 have child 5.
    const members = [1, 2, 3, 4, 5].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [
      ...spousePair(1, 2), ...spousePair(1, 3),
      parentOf(1, 4), parentOf(2, 4),
      parentOf(1, 5), parentOf(3, 5),
    ];
    const roots = buildForest(members, rels, NO_BD);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map(c => c.id).sort()).toEqual([4, 5]); // both kids under the person
    expect(new Set(allIds(roots))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('never drops a branch orphaned by a parent cycle (safety net)', () => {
    // A↔B cycle (each the other's parent) plus a child C. Nobody should vanish.
    const members = [1, 2, 3].map(i => member(i, `P${i}`));
    const rels: RawRelationship[] = [parentOf(1, 2), parentOf(2, 1), parentOf(1, 3)];
    const roots = buildForest(members, rels, NO_BD);
    expect(new Set(allIds(roots))).toEqual(new Set([1, 2, 3]));
  });
});
