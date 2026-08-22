'use client';

import { useState } from 'react';
import { CalendarEvent } from '@/lib/types';
import { EventDetailModal } from './EventDetailModal';
import { useUserPrefs } from './UserPrefsContext';
import { Avatar } from './Avatar';
import { displayName } from '@/lib/names';
import { formatHebrewDateLocalized } from '@/lib/date-format';
import { countLabel } from '@/lib/event-phrase';

const EVENT_ICONS: Record<string, string> = {
  birthday:    '🎂',
  anniversary: '💍',
  yahrtzeit:   '🕯️',
  other:       '📅',
};

function DaysUntilBadge({ days, t }: { days: number; t: (key: string) => string }) {
  if (days === 0) return <span className="text-[11px] font-semibold text-accent-ink">{t('today')}!</span>;
  if (days === 1) return <span className="text-[11px] text-ink-muted">{t('tomorrow')}</span>;
  if (days <= 7) return <span className="text-[11px] font-medium text-accent-ink">{t('in_days').replace('{n}', String(days))}</span>;
  return <span className="text-[11px] text-ink-faint">{t('in_days').replace('{n}', String(days))}</span>;
}

export function UpcomingEvents({ events }: { events: CalendarEvent[] }) {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const { t, showNicknames, language } = useUserPrefs();

  // Group the upcoming list into time buckets so a long list is scannable
  // (previously a flat list). daysUntil is always ≥ 0 here (past occurrences are
  // filtered out upstream), so every event lands in exactly one bucket.
  const groups: { key: string; label: string; items: CalendarEvent[] }[] = [
    { key: 'this_week',  label: t('upcoming.this_week'),  items: events.filter(e => e.daysUntil <= 7) },
    { key: 'this_month', label: t('upcoming.this_month'), items: events.filter(e => e.daysUntil > 7 && e.daysUntil <= 30) },
    { key: 'later',      label: t('upcoming.later'),      items: events.filter(e => e.daysUntil > 30) },
  ].filter(g => g.items.length > 0);

  function renderItem(event: CalendarEvent) {
    const isHebrew = event.dateType === 'hebrew';
    const name = displayName(event, language, showNicknames);
    const monthKey = `months.short.${event.gregorianDate.getMonth()}`;
    const ageLabel = countLabel(event.event_type, event.yearsCount, language);

    // Combined (merged) view only — which family this occurrence belongs to.
    const familyLabel = event.family
      ? (language === 'he' && event.family.nameHe ? event.family.nameHe : event.family.name)
      : null;

    return (
      <li
        key={`${event.family?.id ?? 's'}:${event.id}-${event.event_type}-${event.dateType}`}
        onClick={() => setSelectedEvent(event)}
        className="px-4 py-3 flex items-start gap-3 hover:bg-parchment/60 transition-colors cursor-pointer"
      >
        {/* Date badge */}
        <div className="text-center min-w-[36px] shrink-0">
          <div className="text-[10px] text-ink-faint leading-tight uppercase tracking-wide">
            {t(monthKey)}
          </div>
          <div className="text-lg font-bold text-ink leading-tight font-display">
            {event.gregorianDate.getDate()}
          </div>
        </div>

        {/* Avatar */}
        <Avatar
          name={name}
          photoUrl={event.photo_url}
          branch={event.family_branch}
          size="sm"
          className="shrink-0"
        />

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink truncate">
            {EVENT_ICONS[event.event_type] ?? '📅'} <bdi>{name}</bdi>
          </div>
          {ageLabel && (
            <div className="text-[11px] text-ink-muted mt-0.5">{ageLabel}</div>
          )}
          <div className={`text-[11px] mt-0.5 ${isHebrew ? 'text-accent-ink' : 'text-ink-muted'}`}>
            {isHebrew
              ? `✡ ${formatHebrewDateLocalized(event.hebrew_day, event.hebrew_month, event.hebrew_year, language)}`
              : `📅 ${t(monthKey)} ${event.gregorianDate.getDate()}`
            }
          </div>
          {event.family && (
            <div className="mt-0.5">
              <span style={{ backgroundColor: event.family.color }} className="inline-block w-2 h-2 rounded-full me-1 align-middle" />
              <span className="text-[11px] text-ink-muted"><bdi>{familyLabel}</bdi></span>
            </div>
          )}
          <DaysUntilBadge days={event.daysUntil} t={t} />
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="bg-parchment-card rounded-lg border border-warm-border overflow-hidden">
        <div className="px-4 py-3 border-b border-warm-border/60">
          <h2 className="label text-ink">{t('upcoming.title')}</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">{t('upcoming.empty')}</p>
        ) : (
          groups.map(group => (
            <section key={group.key}>
              <div className="px-4 pt-3 pb-1 bg-parchment/40">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-ink-faint">
                  {group.label}
                </span>
              </div>
              <ul className="divide-y divide-warm-border/40">
                {group.items.map(renderItem)}
              </ul>
            </section>
          ))
        )}
      </div>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </>
  );
}
