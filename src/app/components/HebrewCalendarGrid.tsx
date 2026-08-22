'use client';

import { CalendarEvent, Gathering } from '@/lib/types';
import { DayEvents } from './DayEvents';
import { GatheringChip } from './GatheringChip';
import { useUserPrefs } from './UserPrefsContext';
import type { HebrewMonthModel } from '@/lib/hebrew-calendar';

const HE_DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function HebrewCalendarGrid({
  model,
  events,
  gatherings = [],
  holidays,
  zmanim,
}: {
  model: HebrewMonthModel;
  events: CalendarEvent[]; // already filtered to this Hebrew month
  gatherings?: Gathering[];
  holidays?: Record<number, { name: string; yomTov: boolean; chutzLaaretz?: boolean }>;
  zmanim?: Record<number, { candle?: string; havdalah?: string }>;
}) {
  const { t } = useUserPrefs();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Group events by hebrew_day. Clamp day-30 events onto the last day of a short
  // month (e.g. 30 Cheshvan in a 29-day Cheshvan year) so they don't silently
  // vanish — matching the "observe on the last day" rule used by hebrewToGregorian.
  const lastDay = model.days.length ? model.days[model.days.length - 1].hebrewDay : 30;
  const byDay: Record<number, CalendarEvent[]> = {};
  for (const e of events) {
    // gridDay overrides for occurrences placed on a different Hebrew day than the
    // person's recurring hebrew_day (e.g. a fixed-English birthday).
    const day = Math.min(e.gridDay ?? e.hebrew_day, lastDay);
    (byDay[day] ??= []).push(e);
  }

  // Gatherings are Gregorian-dated; key them by 'YYYY-MM-DD' to match each cell's
  // Gregorian date.
  const gatheringsByDate: Record<string, Gathering[]> = {};
  for (const g of gatherings) (gatheringsByDate[g.gather_date] ??= []).push(g);
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Leading blanks + days. dir="rtl" on the container flips columns so ראשון is rightmost.
  const cells: (HebrewMonthModel['days'][number] | null)[] = [
    ...Array(model.leadingBlanks).fill(null),
    ...model.days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div dir="rtl" className="bg-parchment-card rounded-lg border border-warm-border overflow-hidden">
      <div className="grid grid-cols-7 border-b border-warm-border">
        {HE_DOW.map((d, i) => (
          <div key={i} className={`text-center text-[12px] py-2.5 ${i === 6 ? 'text-accent-ink' : 'text-ink-muted'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          if (!cell) {
            return (
              <div
                key={idx}
                className="min-h-[68px] sm:min-h-[90px] border-s border-b border-warm-border/60 bg-parchment/50"
              />
            );
          }
          const g = cell.gregorian;
          const isToday = `${g.getFullYear()}-${g.getMonth()}-${g.getDate()}` === todayKey;
          const isShabbat = cell.weekday === 6;
          const holiday = holidays?.[cell.hebrewDay];
          const dayZmanim = zmanim?.[cell.hebrewDay];
          const tinted = isShabbat || holiday?.yomTov;
          const dayEvents = byDay[cell.hebrewDay] ?? [];
          return (
            <div
              key={idx}
              className={`relative min-h-[68px] sm:min-h-[90px] p-1 sm:p-1.5 border-s border-b border-warm-border/60 ${tinted ? 'bg-accent-soft/40' : ''}`}
            >
              <span className="ennote absolute end-1.5 top-1.5 text-[9px] text-ink-faint">
                {g.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <div
                className={`font-display text-base ${
                  isToday
                    ? 'sig-today rounded-full w-6 h-6 inline-flex items-center justify-center'
                    : 'text-ink-2'
                }`}
              >
                {cell.gematria}
              </div>
              {holiday && (
                <div className="mt-0.5">
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
                <div className="mt-0.5 text-[9px] leading-tight text-ink-muted">
                  {dayZmanim.candle && (
                    <div className="truncate" title={t('zmanim.candles')}>🕯 {dayZmanim.candle}</div>
                  )}
                  {dayZmanim.havdalah && (
                    <div className="truncate" title={t('zmanim.havdalah')}>✨ {dayZmanim.havdalah}</div>
                  )}
                </div>
              )}
              <div className="mt-0.5">
                {(gatheringsByDate[dateKey(g)] ?? []).length > 0 && (
                  <div className="space-y-0.5 mb-0.5">
                    {(gatheringsByDate[dateKey(g)] ?? []).map(gt => <GatheringChip key={`${gt.family?.id ?? 's'}:${gt.id}`} gathering={gt} />)}
                  </div>
                )}
                <DayEvents events={dayEvents} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
