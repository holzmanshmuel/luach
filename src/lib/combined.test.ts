import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { systemQuery, query } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import {
  computeViewFamilies,
  filterToMemberships,
  mapAcrossFamilies,
  aggregateAcrossFamilies,
} from './combined';
import { getMembershipsForUser, type Membership } from '@/lib/users';
import { familyColorAt } from '@/lib/family-color';
import type { FamilyTag } from '@/lib/types';

// Requires DATABASE_URL pointing at staging Postgres with migrations v9–v12
// applied (families/users/memberships + RLS on the tenant tables). The DB tests
// prove tenant isolation holds when several families' data is merged in memory.

// ---------------------------------------------------------------------------
// Pure core — no DB. Matches the exact contract in the task brief.
// ---------------------------------------------------------------------------
describe('combined core (pure)', () => {
  const memberships: Membership[] = [
    { family_id: 10, role: 'owner', member_person_id: null, family_name: 'B side', family_name_he: null },
    { family_id: 7, role: 'editor', member_person_id: null, family_name: 'A side', family_name_he: 'צד א' },
  ];

  it('filterToMemberships keeps only members, ordered + deduped', () => {
    expect(filterToMemberships([7, 999, 7, 10], memberships)).toEqual([7, 10]);
    expect(filterToMemberships([999], memberships)).toEqual([]);
    expect(filterToMemberships([], memberships)).toEqual([]);
    // preserves candidate order, not membership order
    expect(filterToMemberships([10, 7], memberships)).toEqual([10, 7]);
  });

  it('computeViewFamilies: <2 valid ⇒ single', () => {
    expect(computeViewFamilies([7], memberships, 7).mode).toBe('single');
    // an injected non-member id is dropped, leaving <2 valid ⇒ single (authorization drop)
    expect(computeViewFamilies([7, 999], memberships, 7).mode).toBe('single');
    expect(computeViewFamilies([], memberships, 7).mode).toBe('single');
  });

  it('computeViewFamilies: ≥2 valid ⇒ combined with stable colors + he name', () => {
    const r = computeViewFamilies([10, 7], memberships, 7);
    expect(r.mode).toBe('combined');
    if (r.mode !== 'combined') throw new Error('unreachable');
    expect(r.homeFamilyId).toBe(7);
    // colors assigned by family_id ascending (7 before 10), regardless of selection order
    expect(r.families.map(f => f.id)).toEqual([10, 7]);
    const a = r.families.find(f => f.id === 7)!;
    expect(a.nameHe).toBe('צד א');
    expect(a.color).toMatch(/^#/);
    // family 7 sorts first among {7,10} ⇒ palette slot 0
    expect(a.color).toBe(familyColorAt(0));
    const b = r.families.find(f => f.id === 10)!;
    expect(b.color).toBe(familyColorAt(1));
    expect(a.color).not.toBe(b.color);
  });

  it('computeViewFamilies: authorization drop — a non-member id never becomes a viewed family', () => {
    // client sneaks a family id (999) the user has no membership in, alongside two valid
    const r = computeViewFamilies([7, 10, 999], memberships, 7);
    expect(r.mode).toBe('combined');
    if (r.mode !== 'combined') throw new Error('unreachable');
    expect(r.families.map(f => f.id).sort((x, y) => x - y)).toEqual([7, 10]);
    expect(r.families.some(f => f.id === 999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE GATE — real DB tenant-isolation proof under merge + concurrency.
// ---------------------------------------------------------------------------
describe('aggregation isolation (the gate)', () => {
  // Unique lowercase marker (base-36 has no uppercase A/B, so the A/B checks below
  // can't be tripped by the random suffix).
  const M = `combtest_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

  let userId: number;
  let famAId: number;
  let famBId: number;
  let famCId: number; // a real family the user is NOT a member of
  let tagA: FamilyTag;
  let tagB: FamilyTag;

  // Seed a family's own family_member + one distinct event INSIDE its tenant
  // context (RLS table writes must go through query() under runWithTenant).
  async function seedFamilyData(famId: number, label: 'A' | 'B' | 'C') {
    await runWithTenant(famId, async () => {
      const [member] = await query<{ id: number }>(
        `INSERT INTO family_calendar.family_members (name, last_name, family_branch)
         VALUES ($1, $2, $3) RETURNING id`,
        [`${M}_${label}_person`, `${M}_${label}_last`, 'Other']
      );
      await query(
        `INSERT INTO family_calendar.events
           (family_member_id, event_type, hebrew_day, hebrew_month)
         VALUES ($1, 'birthday', $2, 'Tishrei')`,
        [member.id, label === 'A' ? 1 : label === 'B' ? 2 : 3]
      );
    });
  }

  beforeAll(async () => {
    const [user] = await systemQuery<{ id: number }>(
      `INSERT INTO family_calendar.users (google_sub, email)
       VALUES ($1, $2) RETURNING id`,
      [`${M}_sub`, `${M}@example.com`]
    );
    userId = user.id;

    const [famA] = await systemQuery<{ id: number }>(
      `INSERT INTO family_calendar.families (name, name_he) VALUES ($1, $2) RETURNING id`,
      [`${M}_A_family`, 'משפחת א']
    );
    const [famB] = await systemQuery<{ id: number }>(
      `INSERT INTO family_calendar.families (name, name_he) VALUES ($1, $2) RETURNING id`,
      [`${M}_B_family`, null]
    );
    const [famC] = await systemQuery<{ id: number }>(
      `INSERT INTO family_calendar.families (name, name_he) VALUES ($1, $2) RETURNING id`,
      [`${M}_C_family`, null]
    );
    famAId = famA.id;
    famBId = famB.id;
    famCId = famC.id;

    // The user is an owner of A and B — but NOT of C.
    await systemQuery(
      `INSERT INTO family_calendar.memberships (user_id, family_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'owner')`,
      [userId, famAId, famBId]
    );

    await seedFamilyData(famAId, 'A');
    await seedFamilyData(famBId, 'B');
    await seedFamilyData(famCId, 'C'); // exists in DB, must NEVER surface in the merge

    // Build the FamilyTags the way computeViewFamilies would, from live memberships.
    const memberships = await getMembershipsForUser(userId);
    const resolution = computeViewFamilies([famAId, famBId], memberships, famAId);
    if (resolution.mode !== 'combined') throw new Error('expected combined mode for two families');
    tagA = resolution.families.find(f => f.id === famAId)!;
    tagB = resolution.families.find(f => f.id === famBId)!;
    expect(tagA).toBeDefined();
    expect(tagB).toBeDefined();
  });

  afterAll(async () => {
    // families cascade → family_members → events, and → memberships (v10/v9 FKs);
    // users cascade → any remaining memberships. Only non-RLS deletes are used.
    if (famAId || famBId || famCId) {
      await systemQuery('DELETE FROM family_calendar.families WHERE id = ANY($1)', [
        [famAId, famBId, famCId],
      ]);
    }
    if (userId) {
      await systemQuery('DELETE FROM family_calendar.users WHERE id = $1', [userId]);
    }
  });

  it('returns ONLY each family’s own events, correctly tagged', async () => {
    const merged = await aggregateAcrossFamilies([tagA, tagB], () =>
      query<{ id: number; marker: string }>(
        `SELECT e.id, fm.name AS marker FROM family_calendar.events e
         JOIN family_calendar.family_members fm ON fm.id = e.family_member_id`
      )
    );
    const aItems = merged.filter(m => m.family.id === tagA.id);
    const bItems = merged.filter(m => m.family.id === tagB.id);
    expect(aItems.length).toBeGreaterThan(0);
    expect(bItems.length).toBeGreaterThan(0);
    // no B (or C) data ever appears under A, and vice versa
    expect(aItems.every(i => i.marker.includes('_A_'))).toBe(true);
    expect(aItems.every(i => !i.marker.includes('_B_') && !i.marker.includes('_C_'))).toBe(true);
    expect(bItems.every(i => i.marker.includes('_B_'))).toBe(true);
    expect(bItems.every(i => !i.marker.includes('_A_') && !i.marker.includes('_C_'))).toBe(true);
    // C is a real seeded family — it must never surface (user isn't a member; it's not in the tags)
    expect(merged.some(i => i.marker.includes('_C_'))).toBe(false);
    // each tag contributes exactly its own single seeded event
    expect(aItems).toHaveLength(1);
    expect(bItems).toHaveLength(1);
  });

  it('mapAcrossFamilies scopes each fetch to its own family', async () => {
    const perFamily = await mapAcrossFamilies([tagA, tagB], async (fam) => {
      const rows = await query<{ marker: string }>(
        `SELECT fm.name AS marker FROM family_calendar.family_members fm`
      );
      return { id: fam.id, markers: rows.map(r => r.marker) };
    });
    const a = perFamily.find(p => p.id === tagA.id)!;
    const b = perFamily.find(p => p.id === tagB.id)!;
    expect(a.markers.every(m => m.includes('_A_'))).toBe(true);
    expect(b.markers.every(m => m.includes('_B_'))).toBe(true);
    expect(a.markers.some(m => m.includes('_B_'))).toBe(false);
    expect(b.markers.some(m => m.includes('_A_'))).toBe(false);
  });

  it('holds under concurrent interleaving (hammer)', async () => {
    const fams = [tagA, tagB];
    const runs = Array.from({ length: 60 }, (_, i) => fams[i % 2]);
    const results = await Promise.all(
      runs.map(fam =>
        runWithTenant(fam.id, async () => {
          // random yield to force interleaving of the parallel tenant contexts
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * 8)));
          const [{ fam: guc }] = await query<{ fam: string }>(
            "SELECT current_setting('app.current_family') AS fam"
          );
          const rows = await query<{ marker: string }>(
            `SELECT fm.name AS marker FROM family_calendar.events e
             JOIN family_calendar.family_members fm ON fm.id = e.family_member_id`
          );
          const label = fam.id === tagA.id ? '_A_' : '_B_';
          return {
            expected: fam.id,
            guc: Number(guc),
            rowCount: rows.length,
            markersOk: rows.length > 0 && rows.every(r => r.marker.includes(label)),
          };
        })
      )
    );
    for (const r of results) {
      expect(r.guc).toBe(r.expected); // transaction-local GUC never bled across interleaved runs
      expect(r.rowCount).toBe(1); // each family has exactly its one seeded event, never more
      expect(r.markersOk).toBe(true); // fetched rows never bled to the wrong family
    }
  });
});
