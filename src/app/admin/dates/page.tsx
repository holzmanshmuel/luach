import Link from 'next/link';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { auditEvents, type AuditableEvent } from '@/lib/date-consistency';
import { cleanName } from '@/lib/names';
import { getT, type Lang } from '@/lib/translations';
import { backArrow, dirForLang } from '@/lib/direction';
import { InterpolatedMany } from '@/app/components/Interpolated';
import { DateProblemList } from './DateProblemList';
import { eventTypeLabel, findingDates } from './finding-dates';

export const dynamic = 'force-dynamic';

/**
 * Date check — the owner-facing data-health report.
 *
 * Every event carries two independently-stored dates (a recurring Hebrew day/month
 * and an original Gregorian date) and the calendar renders both. Rows entered
 * through the app agree by construction — the form derives the Hebrew date from the
 * English one — but rows IMPORTED from a family spreadsheet have two hand-typed
 * columns, and a typo in either survives silently forever. This page finds those.
 *
 * Owner-only: the proxy coarse-gates /admin/* on the cached role and requireAdmin()
 * re-verifies it live AND establishes the tenant context the query() below needs,
 * so the report can only ever cover the caller's own family.
 *
 * Bilingual like /admin/access: the language comes from the `lang` cookie, the
 * direction from `dirForLang`, and every sentence from translations.ts. People's
 * names and the dates themselves are DATA — they are never translated, only
 * `<bdi>`-isolated and formatted with the calendar's own date helpers.
 */
export default async function DatesPage() {
  await requireAdmin();

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = dirForLang(lang);

  const rows = await query<AuditableEvent>(
    `SELECT e.id,
            m.name AS person_name,
            e.event_type,
            e.hebrew_day,
            e.hebrew_month,
            e.original_english_date::text AS original_english_date
       FROM family_calendar.events e
       JOIN family_calendar.family_members m ON m.id = e.family_member_id
      ORDER BY m.name`
  );

  // ::text above is deliberate — the pg driver hands back a DATE as a JS Date at
  // local midnight, and formatting that back to a day is exactly how this database
  // once acquired 38 birthdays that were one day early. Keep the string a string.
  const report = auditEvents(
    rows.map(r => ({ ...r, person_name: cleanName(r.person_name) }))
  );
  const { summary, problems, adarChoices } = report;
  const checked = summary.ok + summary.nightfall + summary.mismatch + summary.adar_convention;

  return (
    <div dir={dir} className="min-h-screen bg-parchment">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* The arrow is chosen from `dir` (lib/direction.ts), never typed into a
            label — a literal one points the wrong way on the Hebrew page. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          <span aria-hidden>{backArrow(dir)}</span>
          {t('admin.back')}
        </Link>
        <h1 className="font-display text-3xl text-ink mt-3 mb-1">{t('dates.title')}</h1>
        <p className="text-ink-muted text-sm mb-6">{t('dates.intro')}</p>

        <dl className="grid grid-cols-3 gap-3 mb-8 text-center">
          <Stat value={checked} label={t('dates.stat_checked')} />
          <Stat value={summary.mismatch} label={t('dates.stat_mismatch')} emphasis={summary.mismatch > 0} />
          <Stat value={summary.no_english} label={t('dates.stat_no_english')} />
        </dl>

        {summary.mismatch === 0 && summary.unconvertible === 0 ? (
          <p className="border-y border-warm-border py-6 text-center text-sm text-ink-muted">
            {checked === 0
              ? t('dates.empty_nothing')
              : adarChoices.length > 0
                ? t('dates.empty_adar_only')
                : t('dates.all_agree')}
          </p>
        ) : (
          <DateProblemList problems={problems} />
        )}

        {adarChoices.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl text-ink mb-1">{t('dates.adar_heading')}</h2>
            <p className="text-ink-muted text-sm mb-4">
              {t(adarChoices.length === 1 ? 'dates.adar_intro_one' : 'dates.adar_intro_many')}{' '}
              <strong className="text-ink-2">{t('dates.adar_not_mistyped')}</strong>{' '}
              {t('dates.adar_rule')} {t('dates.adar_advice')}
            </p>
            <div className="border-y border-warm-border divide-y divide-warm-border/60">
              {adarChoices.map(a => {
                const d = findingDates(a, lang);
                return (
                  <div key={a.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink"><bdi>{a.person_name}</bdi></span>
                      <span className="label shrink-0">{eventTypeLabel(a.event_type, t)}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-1">
                      <InterpolatedMany
                        template={t('dates.adar_row')}
                        params={{ hebrew: d.hebrew, english: d.english, falls_on: d.fallsOn }}
                        valueClassName="text-ink-2"
                      />
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-8 space-y-3 text-xs text-ink-faint">
          <p>
            <strong className="text-ink-muted">{t('dates.nightfall_title')}</strong>{' '}
            {t('dates.nightfall_body')}
          </p>
          {summary.no_english > 0 && (
            <p>
              {summary.no_english === 1 ? (
                t('dates.no_english_one')
              ) : (
                <InterpolatedMany template={t('dates.no_english_many')} params={{ n: summary.no_english }} />
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  emphasis = false,
}: {
  value: number;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border border-warm-border rounded-md py-3">
      <dd className={`font-display text-2xl ${emphasis ? 'text-accent' : 'text-ink'}`}>{value}</dd>
      <dt className="label mt-0.5">{label}</dt>
    </div>
  );
}
