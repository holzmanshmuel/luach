'use client';

import { CalendarEvent, Gathering } from '@/lib/types';
import { DayEvents } from './DayEvents';
import { GatheringChip } from './GatheringChip';
import { useUserPrefs } from './UserPrefsContext';
import { civilDayOfMonth, civilMonthGrid, isInCivilMonth, type CivilDay } from '@/lib/civil-day';

export function CalendarGrid({
  year,
  month,
  events,
  gatherings = [],
  holidays,
  zmanim,
  todayDay,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  gatherings?: Gathering[];
  holidays?: Record<number, { name: string; yomTov: boolean; chutzLaaretz?: boolean }>;
  zmanim?: Record<number, { candle?: string; havdalah?: string }>;
  /**
   * Today, as the DEPLOYMENT reckons it (`YYYY-MM-DD`, decided on the server).
   * Not `new Date()` in the browser: a relative in Auckland is already on
   * tomorrow and one in Los Angeles still on yesterday, so the family's calendar
   * would ring a different cell for each of them.
   */
  todayDay: CivilDay;
}) {
  const { t } = useUserPrefs();
  const todayDate = isInCivilMonth(todayDay, year, month) ? civilDayOfMonth(todayDay) : -1;

  // Build calendar grid. Derived in UTC (civilMonthGrid) rather than from a local
  // `new Date(year, month, 1)`, so the column the 1st sits in is the same for
  // every viewer.
  const { firstWeekday: firstDay, days: daysInMonth } = civilMonthGrid(year, month);

  // Group events by day
  const eventsByDay: Record<number, CalendarEvent[]> = {};
  for (const event of events) {
    // Read off the civil-day STRING the server decided — never a Date instant.
    const d = civilDayOfMonth(event.gregorianDay);
    if (!eventsByDay[d]) eventsByDay[d] = [];
    eventsByDay[d].push(event);
  }

  // Group gatherings (one-off, dated) by day-of-month within this year/month.
  const gatheringsByDay: Record<number, Gathering[]> = {};
  for (const g of gatherings) {
    const [gy, gm, gd] = g.gather_date.split('-').map(Number);
    if (gy === year && gm - 1 === month) (gatheringsByDay[gd] ??= []).push(g);
  }

  // Build cells array: null = empty, number = day
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div dir="ltr" className="bg-parchment-card rounded-lg border border-warm-border overflow-hidden">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-warm-border">
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <div
            key={i}
            className="text-center text-[11px] font-medium text-ink-faint uppercase tracking-wider py-2.5"
          >
            {t(`days.${i}`)}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          const dayEvents = day ? (eventsByDay[day] ?? []) : [];
          const dayGatherings = day ? (gatheringsByDay[day] ?? []) : [];
          const holiday = day ? holidays?.[day] : undefined;
          const dayZmanim = day ? zmanim?.[day] : undefined;
          const isToday = day === todayDate;
          const isShabat = idx % 7 === 6;
          const tinted = Boolean(day && (isShabat || holiday?.yomTov));

          return (
            <div
              key={idx}
              className={`min-h-[68px] sm:min-h-[90px] p-1 sm:p-1.5 border-r border-b border-warm-border/60 last:border-r-0
                ${!day ? 'bg-parchment/50' : ''}
                ${tinted ? 'bg-accent-soft/40' : ''}
              `}
            >
              {day && (
                <>
                  <div
                    className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full transition-colors
                      ${isToday ? 'sig-today font-semibold' : 'text-ink-muted'}
                    `}
                  >
                    {day}
                  </div>
                  {holiday && (
                    <div className="mb-1">
                      <div
                        className={`text-[9px] leading-tight truncate ${holiday.yomTov ? 'text-accent-ink font-medium' : 'text-ink-muted'}`}
                        title={holiday.name}
                      >
                        {holiday.name}
                      </div>
                      {holiday.chutzLaaretz && (
                        <div className="text-[8px] leading-tight text-ink-muted italic truncate" title={t('holiday.chutz_title')}>
                          {t('holiday.chutz')}
                        </div>
                      )}
                    </div>
                  )}
                  {dayZmanim && (dayZmanim.candle || dayZmanim.havdalah) && (
                    <div className="mb-0.5 text-[9px] leading-tight text-ink-muted">
                      {dayZmanim.candle && (
                        <div className="truncate" title={t('zmanim.candles')}>🕯 {dayZmanim.candle}</div>
                      )}
                      {dayZmanim.havdalah && (
                        <div className="truncate" title={t('zmanim.havdalah')}>✨ {dayZmanim.havdalah}</div>
                      )}
                    </div>
                  )}
                  {dayGatherings.length > 0 && (
                    <div className="space-y-0.5 mb-0.5">
                      {dayGatherings.map(g => <GatheringChip key={`${g.family?.id ?? 's'}:${g.id}`} gathering={g} />)}
                    </div>
                  )}
                  <DayEvents events={dayEvents} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
