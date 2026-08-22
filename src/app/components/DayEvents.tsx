'use client';

import { useState } from 'react';
import { CalendarEvent } from '@/lib/types';
import { EventCard } from './EventCard';
import { useUserPrefs } from './UserPrefsContext';

/**
 * Renders a day cell's events, capped at `cap` chips with a "+N more" toggle so a
 * busy day (e.g. several birthdays) doesn't stretch the row and collapse the grid.
 */
export function DayEvents({ events, cap = 3 }: { events: CalendarEvent[]; cap?: number }) {
  const { t } = useUserPrefs();
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;
  const shown = expanded ? events : events.slice(0, cap);
  const hidden = events.length - shown.length;

  return (
    <div className="space-y-0.5">
      {shown.map(event => (
        <EventCard key={`${event.family?.id ?? 's'}:${event.id}-${event.event_type}-${event.dateType}`} event={event} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full text-start text-[10px] text-ink-muted hover:text-ink px-1.5 py-0.5 rounded-md hover:bg-parchment-dark transition-colors"
        >
          {t('calendar.more').replace('{n}', String(hidden))}
        </button>
      )}
      {expanded && events.length > cap && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full text-start text-[10px] text-ink-faint hover:text-ink px-1.5 py-0.5 transition-colors"
        >
          {t('calendar.less')}
        </button>
      )}
    </div>
  );
}
