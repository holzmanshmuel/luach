export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { cookies } from 'next/headers';
import { Avatar } from '@/app/components/Avatar';
import { UserPrefsToolbar } from '@/app/components/UserPrefsToolbar';
import { CombinedModeProvider } from '@/app/components/CombinedModeProvider';
import { getT, type Lang } from '@/lib/translations';
import { requireAuth } from '@/lib/auth';
import { fetchTimeline, type TimelineEntry } from '@/lib/calendar-data';
import { resolveViewFamilies, aggregateAcrossFamilies } from '@/lib/combined';

const EVENT_ICONS: Record<string, string> = {
  birthday: '🎂', anniversary: '💍', yahrtzeit: '🕯️', other: '📅',
};

// Muted branch accents, matching the avatar palette.
const BRANCH_ACCENT: Record<string, string> = {
  Levi:  'border-s-[#4C4F30]',
  Cohen: 'border-s-[#3C4A3E]',
  Mizrahi:   'border-s-[#6B4A3E]',
  Adler:     'border-s-[#6B5A2E]',
  Other:     'border-s-warm-border',
};

export default async function TimelinePage() {
  // Establish tenant context before fetchTimeline()'s tenant-scoped query() runs.
  // Backstop only — the proxy redirects signed-out traffic to /login first.
  await requireAuth();

  // Combined-view resolution: which families to merge (empty/single ⇒ plain
  // single-family behavior, byte-for-byte unchanged below).
  const view = await resolveViewFamilies();
  const combined = view?.mode === 'combined';
  const viewFamilies = view?.mode === 'combined' ? view.families : [];

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);

  let entries: TimelineEntry[];
  if (combined) {
    entries = (await aggregateAcrossFamilies(viewFamilies, () => fetchTimeline(lang)))
      .sort((a, b) => a.year - b.year);
  } else {
    entries = await fetchTimeline(lang);
  }

  // Group by decade
  const decades = new Map<number, TimelineEntry[]>();
  for (const entry of entries) {
    const decade = Math.floor(entry.year / 10) * 10;
    const list = decades.get(decade) ?? [];
    list.push(entry);
    decades.set(decade, list);
  }
  const sortedDecades = [...decades.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <CombinedModeProvider combined={combined} viewFamilies={viewFamilies}>
      <div className="min-h-screen bg-parchment" dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <header className="bg-parchment-card border-b border-warm-border px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">
              ← {t('nav.calendar')}
            </Link>
            <span className="text-warm-border">|</span>
            <div className="flex items-center gap-2">
              <span className="text-xl">📜</span>
              <h1 className="font-display text-xl sm:text-2xl font-medium text-ink tracking-wide">{t('nav.timeline')}</h1>
            </div>
          </div>
          <UserPrefsToolbar />
        </header>

        <div className="max-w-4xl mx-auto px-4 py-10">
          {entries.length === 0 ? (
            <p className="text-center text-ink-muted py-12">{t('timeline.empty')}</p>
          ) : (
            <div className="space-y-10">
              {sortedDecades.map(([decade, list]) => (
                <section key={decade}>
                  <div className="mb-5 text-center">
                    <span className="inline-block font-display text-2xl font-semibold text-ink bg-parchment px-3 py-0.5 rounded-full border border-warm-border">
                      {decade}s
                    </span>
                  </div>
                  <ol className="space-y-4 max-w-2xl mx-auto">
                    {list.map(entry => {
                      const branchClass = BRANCH_ACCENT[entry.family_branch ?? 'Other'] ?? BRANCH_ACCENT.Other;
                      const icon = EVENT_ICONS[entry.event_type] ?? '📅';
                      // Combined (merged) view only — which family this occurrence belongs
                      // to. When set, its color overrides the branch accent stripe.
                      const familyLabel = entry.family
                        ? (lang === 'he' && entry.family.nameHe ? entry.family.nameHe : entry.family.name)
                        : null;
                      return (
                        <li key={`${entry.family?.id ?? 's'}:${entry.id}-${entry.event_type}`}>
                          <article
                            className={`bg-parchment-card border border-warm-border border-s-4 ${branchClass} rounded-lg p-4`}
                            style={entry.family ? { borderInlineStartColor: entry.family.color } : undefined}
                          >
                            <div className="flex items-start gap-3">
                              <Avatar name={entry.name} photoUrl={entry.photo_url} branch={entry.family_branch as never} size="md" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-ink-faint flex items-center gap-1.5">
                                  <span>{entry.year}{entry.ageOrLabel ? ` · ${entry.ageOrLabel}` : ''}</span>
                                  {entry.family && (
                                    <span className="inline-flex items-center">
                                      <span style={{ backgroundColor: entry.family.color }} className="inline-block w-2 h-2 rounded-full me-1 align-middle" />
                                      <bdi>{familyLabel}</bdi>
                                    </span>
                                  )}
                                </div>
                                <div className="font-display text-lg font-semibold text-ink">
                                  {icon} {entry.name}
                                </div>
                                <div className="text-[11px] text-ink-muted">{entry.typeLabel}</div>
                                <div className="mt-1.5 text-xs text-ink-muted space-y-0.5">
                                  <div>✡ {entry.hebrewDate}</div>
                                  {entry.englishDate && <div className="text-ink-faint">📅 {entry.englishDate}</div>}
                                </div>
                              </div>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </CombinedModeProvider>
  );
}
