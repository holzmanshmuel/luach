import { type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { CalendarEvent } from '@/lib/types';
import { getT, type Lang } from '@/lib/translations';
import { displayName } from '@/lib/names';
import { formatHebrewDateLocalized } from '@/lib/date-format';
import { ordinal } from '@/lib/event-phrase';

const EVENT_ICONS: Record<string, string> = {
  birthday:    '🎂',
  anniversary: '💍',
  yahrtzeit:   '🕯️',
  other:       '📅',
};

function phraseFor(event: CalendarEvent, lang: Lang): ReactNode {
  // The name is wrapped in <bdi> so a mixed-script (Latin+Hebrew) name can't
  // visually reorder against the surrounding Hebrew/English sentence.
  const nm = <bdi>{displayName(event, lang)}</bdi>;
  // Nth count is computed server-side in Hebrew years (correct across Jan 1).
  const years = event.yearsCount ?? null;
  const he = lang === 'he';
  const nth = years && years > 0;

  switch (event.event_type) {
    case 'birthday':
      if (nth) return he ? <>יום הולדת {years} ל־{nm}</> : <>{nm}&rsquo;s {ordinal(years!)} birthday</>;
      return he ? <>יום הולדת ל־{nm}</> : <>{nm}&rsquo;s birthday</>;
    case 'anniversary':
      if (nth) return he ? <>יום נישואין {years} של {nm}</> : <>{nm}&rsquo;s {ordinal(years!)} anniversary</>;
      return he ? <>יום נישואין של {nm}</> : <>{nm}&rsquo;s anniversary</>;
    case 'yahrtzeit':
      if (nth) return he ? <>יארצייט {years} של {nm}</> : <>{nm}&rsquo;s {ordinal(years!)} yahrzeit</>;
      return he ? <>יארצייט של {nm}</> : <>{nm}&rsquo;s yahrzeit</>;
    default:
      return nm;
  }
}

export async function OnThisDay({ events }: { events: CalendarEvent[] }) {
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);

  const today = events.filter(e => e.daysUntil === 0);
  const thisWeek = events.filter(e => e.daysUntil > 0 && e.daysUntil <= 7);

  // Deduplicate by (family, id, event_type, day) so a hebrew + gregorian occurrence
  // that coincides on the SAME day collapses to one line, but a birthday's Hebrew and
  // solar occurrences on DIFFERENT days both show (the old key dropped the second).
  // The family?.id prefix keeps the combined (merged) view safe: two DIFFERENT
  // families can have events sharing the same numeric id, and without the prefix
  // those would falsely dedup against each other.
  const seen = new Set<string>();
  const dedupe = (list: CalendarEvent[]) =>
    list.filter(e => {
      const key = `${e.family?.id ?? 's'}-${e.id}-${e.event_type}-${e.daysUntil}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const todayUnique = dedupe(today);
  // Continues from the same `seen` set, so a birthday's Hebrew + Gregorian
  // occurrences don't double-list, and an event already shown under "Today"
  // isn't repeated under "This week".
  const thisWeekUnique = dedupe(thisWeek);

  if (todayUnique.length === 0 && thisWeekUnique.length === 0) return null;

  const todayLabel = lang === 'he' ? 'היום' : 'Today';
  const thisWeekLabel = lang === 'he' ? 'השבוע' : 'This week';
  const emptyTodayLabel = lang === 'he'
    ? 'אין אירועים משפחתיים היום'
    : 'No family events today';

  return (
    <section
      aria-label={todayLabel}
      className="mb-6 rounded-lg border border-warm-border bg-parchment-card overflow-hidden"
    >
      <div className="px-5 py-4">
        {todayUnique.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="label text-accent-ink">
                {todayLabel}
              </span>
              <div className="h-px flex-1 bg-warm-border" />
            </div>
            <ul className="space-y-1.5">
              {todayUnique.map(e => {
                const familyLabel = e.family
                  ? (lang === 'he' && e.family.nameHe ? e.family.nameHe : e.family.name)
                  : null;
                return (
                  <li key={`${e.family?.id ?? 's'}-${e.id}-${e.event_type}-${e.daysUntil}`} className="flex items-baseline gap-2">
                    <span className="text-lg leading-none">{EVENT_ICONS[e.event_type] ?? '📅'}</span>
                    <span className="font-display text-lg text-ink">
                      {phraseFor(e, lang)}
                    </span>
                    <span className="text-[11px] text-ink-faint ms-1">
                      {formatHebrewDateLocalized(e.hebrew_day, e.hebrew_month, e.hebrew_year, lang)}
                    </span>
                    {e.family && (
                      <span className="text-[11px] text-ink-faint ms-1 inline-flex items-center">
                        <span style={{ backgroundColor: e.family.color }} className="inline-block w-2 h-2 rounded-full me-1 align-middle" />
                        <bdi>{familyLabel}</bdi>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-ink-muted">{emptyTodayLabel}.</p>
        )}

        {thisWeekUnique.length > 0 && (
          <div className="mt-4 pt-3 border-t border-warm-border/60">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-ink-faint">
                {thisWeekLabel}
              </span>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              {thisWeekUnique.slice(0, 8).map(e => {
                const rawName = displayName(e, lang);
                const daysLabel = e.daysUntil === 1
                  ? t('tomorrow')
                  : t('in_days').replace('{n}', String(e.daysUntil));
                const familyLabel = e.family
                  ? (lang === 'he' && e.family.nameHe ? e.family.nameHe : e.family.name)
                  : null;
                return (
                  <li key={`${e.family?.id ?? 's'}-${e.id}-${e.event_type}-${e.daysUntil}`} className="whitespace-nowrap">
                    <span className="me-1">{EVENT_ICONS[e.event_type] ?? '📅'}</span>
                    <span className="text-ink">{rawName}</span>
                    <span className="ms-1 text-ink-faint">· {daysLabel}</span>
                    {e.family && (
                      <span className="ms-1 text-ink-faint inline-flex items-center">
                        <span style={{ backgroundColor: e.family.color }} className="inline-block w-2 h-2 rounded-full me-1 align-middle" />
                        <bdi>{familyLabel}</bdi>
                      </span>
                    )}
                  </li>
                );
              })}
              {thisWeekUnique.length > 8 && (
                <li className="whitespace-nowrap text-ink-faint">
                  +{thisWeekUnique.length - 8}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
