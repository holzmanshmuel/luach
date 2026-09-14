import { cookies } from 'next/headers';
import Link from 'next/link';
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getT, type Lang } from '@/lib/translations';
import { backArrow, dirForLang } from '@/lib/direction';
import { ReviewNamesPanel, type NameRow } from './ReviewNamesPanel';

export const dynamic = 'force-dynamic';

export default async function NamesPage() {
  // /admin/* is coarse-gated to owners by the proxy; requireAdmin re-verifies the
  // live owner role AND establishes tenant context before the query() below.
  await requireAdmin();

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = dirForLang(lang);

  const rows = await query<NameRow>(
    `SELECT id, name, name_he, name_he_status
     FROM family_calendar.family_members
     ORDER BY name_he_status NULLS FIRST, name`
  );

  return (
    <div dir={dir} className="min-h-screen bg-parchment">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* The arrow comes from `dir` (lib/direction.ts), never from the label. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          <span aria-hidden>{backArrow(dir)}</span>
          {t('admin.back')}
        </Link>
        <h1 className="font-display text-3xl text-ink mt-3 mb-1">{t('names.title')}</h1>
        <p className="text-ink-muted text-sm mb-6">{t('names.intro')}</p>
        <ReviewNamesPanel rows={rows} />
      </div>
    </div>
  );
}
