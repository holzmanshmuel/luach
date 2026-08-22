'use client';

import { useUserPrefs } from './UserPrefsContext';
import { EVENT_STYLE, eventTint } from '@/lib/event-style';
import type { EventType } from '@/lib/types';

// Each legend chip mirrors how the event renders on the grid: its tint, icon, and
// (for birthdays) the ✡/☀ marker showing which calendar the occurrence is on.
const ITEMS: { type: EventType; dateType: 'hebrew' | 'gregorian'; marker?: string }[] = [
  { type: 'birthday', dateType: 'hebrew', marker: '✡' },
  { type: 'birthday', dateType: 'gregorian', marker: '☀' },
  { type: 'anniversary', dateType: 'gregorian' },
  { type: 'yahrtzeit', dateType: 'gregorian' },
  { type: 'other', dateType: 'gregorian' },
];

export function CalendarLegend() {
  const { t } = useUserPrefs();

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 px-1">
      <span className="label">{t('legend.title')}</span>
      {ITEMS.map(({ type, dateType, marker }) => {
        const tint = eventTint(type, dateType);
        return (
          <span
            key={`${type}-${dateType}`}
            className="flex items-center gap-1 text-[11px] text-ink-2 border rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: tint.bg, borderColor: tint.border }}
          >
            <span aria-hidden>{EVENT_STYLE[type].icon}</span>
            {t(EVENT_STYLE[type].labelKey)}
            {marker && <span className="text-[9px] opacity-70" aria-hidden>{marker}</span>}
          </span>
        );
      })}
    </div>
  );
}
