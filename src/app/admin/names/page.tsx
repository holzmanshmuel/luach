import { query } from '@/lib/db';
import { ReviewNamesPanel, type NameRow } from './ReviewNamesPanel';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NamesPage() {
  // /admin/* is coarse-gated to owners by the proxy; requireAdmin re-verifies the
  // live owner role AND establishes tenant context before the query() below.
  await requireAdmin();

  const rows = await query<NameRow>(
    `SELECT id, name, name_he, name_he_status
     FROM family_calendar.family_members
     ORDER BY name_he_status NULLS FIRST, name`
  );

  // dir="ltr" below is deliberate. This page is hardcoded English (like its
  // sibling admin pages), but the root layout sets dir="rtl" for a Hebrew
  // viewer — which scrambles the English text, reorders rows and turns
  // "← Calendar" into "Calendar ←". Pinning the direction to the language the
  // page is actually written in keeps it readable until it is translated.
  return (
    <div dir="ltr" className="min-h-screen bg-parchment">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">← Calendar</Link>
        <h1 className="font-display text-3xl text-ink mt-3 mb-1">Hebrew names</h1>
        <p className="text-ink-muted text-sm mb-6">
          Confirm or correct the suggested Hebrew spelling for each person. Confirmed names show in Hebrew mode;
          anything left blank falls back to the English name.
        </p>
        <ReviewNamesPanel rows={rows} />
      </div>
    </div>
  );
}
