'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AddEditModal } from './AddEditModal';
import { GatheringModal } from './GatheringModal';
import { CombinedModeNotice } from './CombinedModeNotice';
import { useCombinedMode } from './CombinedModeProvider';
import { useUserPrefs } from './UserPrefsContext';
import { stepHebrewMonth, type HebrewMonthModel } from '@/lib/hebrew-calendar';
import { CHEVRON_BIDI, flexRowChevron } from '@/lib/direction';
import { isInCivilMonth, type CivilDay } from '@/lib/civil-day';

function prevMonth(year: number, month: number) {
  if (month === 0) return { year: year - 1, month: 11 };
  return { year, month: month - 1 };
}

function nextMonth(year: number, month: number) {
  if (month === 11) return { year: year + 1, month: 0 };
  return { year, month: month + 1 };
}

const arrowBtn =
  'w-8 h-8 flex items-center justify-center rounded-full hover:bg-parchment-dark text-ink-muted hover:text-ink transition-colors text-xl';

/**
 * The Add-Event / Add-Simcha controls. Combined (merged) view is read-only, so
 * instead of opening the real create modals these open `CombinedModeNotice` —
 * same trigger-button look as the single-family case (below), just a
 * different click target. In single-family mode this renders exactly as
 * before: the real `GatheringModal`/`AddEditModal` create triggers.
 */
function AddButtons() {
  const { t } = useUserPrefs();
  const { combined } = useCombinedMode();
  const [showNotice, setShowNotice] = useState(false);

  if (!combined) {
    return (
      <div className="flex items-center gap-2">
        <GatheringModal mode="create" />
        <AddEditModal mode="create" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNotice(true)}
          className="inline-flex items-center gap-2 rounded-full border border-warm-border bg-parchment-card px-4 py-2 text-sm font-medium text-ink hover:bg-parchment-dark transition-colors"
        >
          🎉 {t('gathering.add')}
        </button>
        <button
          type="button"
          onClick={() => setShowNotice(true)}
          className="sig-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
        >
          + {t('action.add_event')}
        </button>
      </div>
      {showNotice && <CombinedModeNotice onClose={() => setShowNotice(false)} />}
    </>
  );
}

export function MonthNav({
  year,
  month,
  hebrew,
  todayDay,
}: {
  year?: number;
  month?: number;
  hebrew?: { model: HebrewMonthModel; hMonth: number; hYear: number; isCurrent?: boolean };
  /**
   * Today, as the DEPLOYMENT reckons it (`YYYY-MM-DD`, decided on the server).
   * Only the Gregorian branch needs it — the Hebrew branch is told `isCurrent`
   * by the page, which resolves it the same way. Browser-side `new Date()` would
   * hide the "Today" link a day early for a relative in Los Angeles.
   */
  todayDay?: CivilDay;
}) {
  const { t, canEdit } = useUserPrefs();

  // ── Hebrew-month navigation ──
  //
  // The row is dir="rtl", so its FIRST child lands on the RIGHT. That is why the
  // chevrons here are the mirror of the Gregorian branch's and why they are asked
  // for by DOM position rather than typed in: the "next month" link renders first,
  // on the right, and so must point right.
  //
  // ⚠ Both links carry CHEVRON_BIDI (dir="ltr"). '‹'/'›' are Bidi_Mirrored, so
  // inside a dir="rtl" run the browser paints the OPPOSITE glyph — verified from
  // rendered pixels, not from the DOM text. Without the isolation this branch
  // shows the mirror of what the source says, and every future edit here is a coin
  // flip. Do not remove it.
  if (hebrew) {
    const prev = stepHebrewMonth(hebrew.hMonth, hebrew.hYear, -1);
    const next = stepHebrewMonth(hebrew.hMonth, hebrew.hYear, 1);
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4" dir="rtl">
        <div className="flex items-center gap-2">
          <Link href={`/?hmonth=${next.hebrewMonth}&hyear=${next.hebrewYear}`} className={arrowBtn} aria-label="חודש הבא" {...CHEVRON_BIDI}>
            {flexRowChevron('rtl', 0)}
          </Link>
          <h2 className="font-display text-2xl font-medium text-ink min-w-[160px] sm:min-w-[190px] text-center">
            {hebrew.model.monthLabelHe} <span className="text-ink-faint">{hebrew.model.yearLabelHe}</span>
          </h2>
          <Link href={`/?hmonth=${prev.hebrewMonth}&hyear=${prev.hebrewYear}`} className={arrowBtn} aria-label="חודש קודם" {...CHEVRON_BIDI}>
            {flexRowChevron('rtl', 1)}
          </Link>
          {hebrew.isCurrent === false && (
            <Link href="/" className="text-xs text-accent-ink hover:text-ink mr-1 underline underline-offset-2 transition-colors">
              {t('today')}
            </Link>
          )}
        </div>
        {canEdit && <AddButtons />}
      </div>
    );
  }

  // ── Gregorian-month navigation (English baseline) ──
  // LTR row: the "previous" link renders first, on the LEFT, and points left.
  const y = year!;
  const m = month!;
  const prev = prevMonth(y, m);
  const next = nextMonth(y, m);
  const isCurrentMonth = todayDay ? isInCivilMonth(todayDay, y, m) : false;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <div className="flex items-center gap-2">
        <Link href={`/?year=${prev.year}&month=${prev.month}`} className={arrowBtn} aria-label="Previous month" {...CHEVRON_BIDI}>
          {flexRowChevron('ltr', 0)}
        </Link>
        <h2 className="font-display text-2xl font-medium text-ink min-w-[150px] sm:min-w-[190px] text-center tracking-wide">
          {t(`months.${m}`)} {y}
        </h2>
        <Link href={`/?year=${next.year}&month=${next.month}`} className={arrowBtn} aria-label="Next month" {...CHEVRON_BIDI}>
          {flexRowChevron('ltr', 1)}
        </Link>
        {!isCurrentMonth && (
          <Link href="/" className="text-xs text-accent-ink hover:text-ink ml-1 underline underline-offset-2 transition-colors">
            {t('today')}
          </Link>
        )}
      </div>
      {canEdit && <AddButtons />}
    </div>
  );
}
