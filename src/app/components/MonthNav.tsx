'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AddEditModal } from './AddEditModal';
import { GatheringModal } from './GatheringModal';
import { CombinedModeNotice } from './CombinedModeNotice';
import { useCombinedMode } from './CombinedModeProvider';
import { useUserPrefs } from './UserPrefsContext';
import { stepHebrewMonth, type HebrewMonthModel } from '@/lib/hebrew-calendar';

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
}: {
  year?: number;
  month?: number;
  hebrew?: { model: HebrewMonthModel; hMonth: number; hYear: number; isCurrent?: boolean };
}) {
  const { t, canEdit } = useUserPrefs();

  // ── Hebrew-month navigation ──
  if (hebrew) {
    const prev = stepHebrewMonth(hebrew.hMonth, hebrew.hYear, -1);
    const next = stepHebrewMonth(hebrew.hMonth, hebrew.hYear, 1);
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4" dir="rtl">
        <div className="flex items-center gap-2">
          <Link href={`/?hmonth=${next.hebrewMonth}&hyear=${next.hebrewYear}`} className={arrowBtn} aria-label="חודש הבא">‹</Link>
          <h2 className="font-display text-2xl font-medium text-ink min-w-[160px] sm:min-w-[190px] text-center">
            {hebrew.model.monthLabelHe} <span className="text-ink-faint">{hebrew.model.yearLabelHe}</span>
          </h2>
          <Link href={`/?hmonth=${prev.hebrewMonth}&hyear=${prev.hebrewYear}`} className={arrowBtn} aria-label="חודש קודם">›</Link>
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
  const y = year!;
  const m = month!;
  const prev = prevMonth(y, m);
  const next = nextMonth(y, m);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <div className="flex items-center gap-2">
        <Link href={`/?year=${prev.year}&month=${prev.month}`} className={arrowBtn} aria-label="Previous month">‹</Link>
        <h2 className="font-display text-2xl font-medium text-ink min-w-[150px] sm:min-w-[190px] text-center tracking-wide">
          {t(`months.${m}`)} {y}
        </h2>
        <Link href={`/?year=${next.year}&month=${next.month}`} className={arrowBtn} aria-label="Next month">›</Link>
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
