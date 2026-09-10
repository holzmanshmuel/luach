import Link from 'next/link';
import { query } from '@/lib/db';
import { requireAdmin, getSession } from '@/lib/auth';
import { familyBranches, storedFamilyBranches } from '@/lib/branches-server';
import { BranchesPanel } from './BranchesPanel';

export const dynamic = 'force-dynamic';

/**
 * How many people are filed under each branch VALUE currently stored on
 * `family_members.family_branch` — including values that are no longer in the
 * list. `family_branch` is free TEXT with no foreign key, so renaming or removing
 * a branch does NOT move anybody: those people keep their stored value, render in
 * the neutral tint and filter under the catch-all chip. Nothing breaks, but the
 * owner should hear it before saving, not discover it after.
 *
 * Deliberately a plain query in this Server Component rather than an export from
 * `actions.ts` — every export of a `'use server'` module is a callable endpoint,
 * and this one wants no endpoint of its own.
 */
async function branchMemberCounts(): Promise<Record<string, number>> {
  const rows = await query<{ branch: string | null; n: number }>(
    `SELECT family_branch AS branch, COUNT(*)::int AS n
       FROM family_calendar.family_members
      GROUP BY family_branch`
  );
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.branch) counts[r.branch] = Number(r.n);
  return counts;
}

export default async function BranchesAdminPage() {
  // /admin/* is coarse-gated to owners by the proxy; requireAdmin re-verifies the
  // live owner role AND establishes tenant context before the reads below.
  await requireAdmin();

  const session = await getSession();
  const familyId = session.familyId!; // requireAdmin threw if this were unset

  const [branches, stored, counts] = await Promise.all([
    familyBranches(),
    storedFamilyBranches(familyId),
    branchMemberCounts(),
  ]);

  // Nothing stored ⇒ this family is showing the list the deployment supplies
  // (FAMILY_BRANCHES, or the built-in demo names). Saving once here makes it
  // theirs, and from then on the deployment's value no longer reaches them.
  const inherited = stored === null || stored.length === 0;

  // dir="ltr" below is deliberate. This page is hardcoded English (like its
  // sibling admin pages), but the root layout sets dir="rtl" for a Hebrew
  // viewer — which scrambles the English text, reorders rows and turns
  // "← Calendar" into "Calendar ←". Pinning the direction to the language the
  // page is actually written in keeps it readable until it is translated.
  return (
    <div dir="ltr" className="min-h-screen bg-parchment">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">← Calendar</Link>
        <h1 className="font-display text-3xl text-ink mt-3 mb-1">Family branches</h1>
        <p className="text-ink-muted text-sm mb-6">
          A branch is a side of your family — usually a surname. Luach tints each person&apos;s
          avatar, tree card and timeline entry by the branch they are filed under, so the sides
          are easy to tell apart at a glance.
        </p>
        <BranchesPanel branches={branches} counts={counts} inherited={inherited} />
      </div>
    </div>
  );
}
