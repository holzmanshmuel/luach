import Link from 'next/link';
import { UserPrefsToolbar } from './UserPrefsToolbar';
import { SubscribeModal } from './SubscribeModal';
import { DateConverterModal } from './DateConverterModal';
import { FamilySwitcher } from './FamilySwitcher';
import { getT, type Lang } from '@/lib/translations';
import type { Membership } from '@/lib/users';

export function Header({
  lang,
  isAdmin,
  memberships,
  activeFamilyId,
  selectedIds,
}: {
  lang: Lang;
  isAdmin: boolean;
  memberships: Membership[];
  activeFamilyId: number | null;
  selectedIds: number[];
}) {
  const t = getT(lang);
  return (
    <header className="bg-parchment-card border-b border-warm-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-y-3">
      <div className="flex items-center gap-3">
        <span className="sig-star text-xl leading-none">✡</span>
        <h1 className="font-display text-xl sm:text-2xl font-medium text-ink tracking-wide">
          {t('calendar.title')}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <UserPrefsToolbar />
        <div className="w-px h-4 bg-warm-border" />
        <Link href="/tree" aria-label={t('nav.tree')} title={t('nav.tree')} className="label hover:text-ink flex items-center gap-1.5 transition-colors">
          <span aria-hidden>🌳</span><span className="hidden sm:inline">{t('nav.tree')}</span>
        </Link>
        <Link href="/timeline" aria-label={t('nav.timeline')} title={t('nav.timeline')} className="label hover:text-ink flex items-center gap-1.5 transition-colors">
          <span aria-hidden>📜</span><span className="hidden sm:inline">{t('nav.timeline')}</span>
        </Link>
        <DateConverterModal label={t('nav.convert')} />
        {activeFamilyId !== null && (
          <FamilySwitcher
            lang={lang}
            memberships={memberships}
            activeFamilyId={activeFamilyId}
            selectedIds={selectedIds}
          />
        )}
        {isAdmin && (
          <Link
            href="/admin/access"
            className="label hover:text-ink flex items-center gap-1.5 transition-colors"
            title={t('nav.access')}
          >
            <span>🔑</span><span className="hidden sm:inline">{t('nav.access')}</span>
          </Link>
        )}
        {isAdmin && (
          <Link
            href="/admin/names"
            className="label hover:text-ink flex items-center gap-1.5 transition-colors"
            title={t('nav.hebrew_names')}
          >
            <span aria-hidden>א</span><span className="hidden sm:inline">{t('nav.hebrew_names')}</span>
          </Link>
        )}
        {isAdmin && (
          <Link
            href="/admin/dates"
            className="label hover:text-ink flex items-center gap-1.5 transition-colors"
            title={t('nav.date_check')}
          >
            <span aria-hidden>🩺</span><span className="hidden sm:inline">{t('nav.date_check')}</span>
          </Link>
        )}
        <SubscribeModal label={t('nav.subscribe')} />
        {/* Plain <a>, NOT <Link>: Next prefetches <Link> hrefs, and prefetching
            this destructive GET endpoint silently logs the user out on page load. */}
        <a href="/api/logout" className="text-xs text-ink-faint hover:text-ink-muted transition-colors">
          {t('nav.signout')}
        </a>
      </div>
    </header>
  );
}
