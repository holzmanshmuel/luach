'use client';

import { CalendarEvent, Gathering } from '@/lib/types';
import { DayEvents } from './DayEvents';
import { GatheringChip } from './GatheringChip';
import { useUserPrefs } from './UserPrefsContext';
import type { HebrewMonthModel } from '@/lib/hebrew-calendar';
import { formatCivilDayShort } from '@/lib/date-format';
import type { CivilDay } from '@/lib/civil-day';

const HE_DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function HebrewCalendarGrid({
  model,
  events,
  gatherings = [],
  holidays,
  zmanim,
  todayDay,
}: {
  model: HebrewMonthModel;
  events: CalendarEvent[]; // already filtered to this Hebrew month
  gatherings?: Gathering[];
  holidays?: Record<number, { name: string; yomTov: boolean; chutzLaaretz?: boolean }>;
  zmanim?: Record<number, { candle?: string; havdalah?: string }>;
  /**
   * Today, as the DEPLOYMENT reckons it (`YYYY-MM-DD`, decided on the server) —
   * not `new Date()` in the browser, which rings a different cell for a relative
   * in Los Angeles than for one in Jerusalem.
   */
  todayDay: CivilDay;
}) {
  const { t } = useUserPrefs();

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

  // Gatherings are Gregorian-dated; both sides are already 'YYYY-MM-DD' strings
  // (gather_date comes out of Postgres via to_char, and each cell carries the
  // civil day the server resolved), so this is a plain string match — no Date,
  // no clock, nothing for a viewer's zone to shift.
  const gatheringsByDate: Record<string, Gathering[]> = {};
  for (const g of gatherings) (gatheringsByDate[g.gather_date] ??= []).push(g);

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
          const isToday = cell.ymd === todayDay;
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
              <span className="ennote absolute start-1.5 top-1.5 text-[9px] text-ink-faint">
                {formatCivilDayShort(cell.ymd)}
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
                {(gatheringsByDate[cell.ymd] ?? []).length > 0 && (
                  <div className="space-y-0.5 mb-0.5">
                    {(gatheringsByDate[cell.ymd] ?? []).map(gt => <GatheringChip key={`${gt.family?.id ?? 's'}:${gt.id}`} gathering={gt} />)}
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
