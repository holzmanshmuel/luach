'use client';

import { useState } from 'react';
import { CalendarEvent } from '@/lib/types';
import { EventDetailModal } from './EventDetailModal';
import { useUserPrefs } from './UserPrefsContext';
import { eventStyle, eventTint } from '@/lib/event-style';
import { displayName } from '@/lib/names';

export function EventCard({ event }: { event: CalendarEvent }) {
  const [showDetail, setShowDetail] = useState(false);
  const { showNicknames, t, language } = useUserPrefs();

  const style = eventStyle(event.event_type);
  const fullName = displayName(event, language, showNicknames);
  const firstName = fullName.split(' ')[0];
  const isHebrew = event.dateType === 'hebrew';
  const tint = eventTint(event.event_type, event.dateType);

  // e.g. "Noa's birthday (Hebrew)" / "יום הולדת נועה (עברי)" — the
  // Hebrew/English distinction lives here rather than a cryptic H/E tag.
  const occ = isHebrew ? t('event.hebrew') : t('event.english');
  const baseTitle = language === 'he'
    ? `${t(style.labelKey)} ${fullName} (${occ})`
    : `${fullName}'s ${t(style.labelKey).toLowerCase()} (${occ})`;
  // Surfaces which family this occurrence belongs to (combined view only) since
  // the tiny grid chip has no room for a label — the stripe + hover tooltip do.
  const familyName = event.family
    ? (language === 'he' && event.family.nameHe ? event.family.nameHe : event.family.name)
    : null;
  const title = familyName ? `${baseTitle} · ${familyName}` : baseTitle;

  return (
    <>
      <button
        onClick={() => setShowDetail(true)}
        className="w-full text-left flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md text-ink-2 border transition-[filter] hover:brightness-95 leading-5"
        style={{
          backgroundColor: tint.bg,
          borderColor: tint.border,
          ...(event.family && {
            borderInlineStartWidth: '4px',
            borderInlineStartColor: event.family.color,
          }),
        }}
        title={title}
        aria-label={title}
      >
        <span className="shrink-0" aria-hidden>{style.icon}</span>
        <span className="truncate">{firstName}</span>
        {/* Birthdays appear on both their Hebrew and Gregorian dates — a small
            trailing marker shows which calendar this occurrence belongs to. */}
        {event.event_type === 'birthday' && (
          <span
            className={`shrink-0 ms-auto text-[9px] leading-none ${isHebrew ? 'text-accent-ink' : 'text-amber-600'}`}
            aria-hidden
          >
            {isHebrew ? '✡' : '☀'}
          </span>
        )}
      </button>

      {showDetail && (
        <EventDetailModal event={event} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
