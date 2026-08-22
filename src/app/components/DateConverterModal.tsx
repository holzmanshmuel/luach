'use client';

import { useState, useEffect } from 'react';
import { HEBREW_MONTHS } from '@/lib/types';
import { Modal, btnGhost } from './Modal';
import { useUserPrefs } from './UserPrefsContext';

const cell =
  'w-full bg-transparent border-b border-warm-border focus:border-accent py-1.5 text-ink text-sm text-center outline-none transition-colors';

/**
 * Render a converter result. Distinguishes three states so a failed conversion
 * surfaces a human message inline (previously it showed a bare "—" em-dash):
 *  - null  → nothing entered yet: show the placeholder hint
 *  - '—'   → the conversion failed (lib returned null / API not-ok): show why
 *  - other → the converted date, or '…' while loading
 */
function ResultValue({
  display,
  placeholder,
  failedText,
}: {
  display: string | null;
  placeholder: string;
  failedText: string;
}) {
  if (display === null) {
    return <span className="text-ink-faint italic font-normal">{placeholder}</span>;
  }
  if (display === '—') {
    return <span className="text-[#B45309] text-xs font-normal">{failedText}</span>;
  }
  return <>{display}</>;
}

// A Hebrew year is a leap year (13 months, with Adar I + Adar II) when
// (7·year + 1) mod 19 < 7 — the Metonic cycle. Computed locally so we don't
// bundle @hebcal/core into the client.
const isHebrewLeapYear = (y: number) => (7 * y + 1) % 19 < 7;

// Month options to offer for a Hebrew date the user is converting to English.
// NOTE: the year field here is the GREGORIAN year. A Gregorian year overlaps two
// Hebrew years (the boundary is around Rosh Hashana); Adar sits in the earlier
// one. We offer Adar I / Adar II when EITHER overlapping Hebrew year is a leap
// year and plain "Adar" when either is common — permissive, so we never wrongly
// block a valid pick. (The old code fed the Gregorian year straight into the
// Hebrew-leap formula, which is meaningless and hid Adar I/II when they were valid.)
const HEBREW_YEAR_OFFSET = 3760;
function selectableMonths(gregYear: number | ''): readonly string[] {
  if (typeof gregYear !== 'number' || gregYear < 1) return HEBREW_MONTHS; // show all until a year is set
  const hy1 = gregYear + HEBREW_YEAR_OFFSET;
  const hy2 = gregYear + HEBREW_YEAR_OFFSET + 1;
  const anyLeap = isHebrewLeapYear(hy1) || isHebrewLeapYear(hy2);
  const anyCommon = !isHebrewLeapYear(hy1) || !isHebrewLeapYear(hy2);
  return HEBREW_MONTHS.filter(m => {
    if (m === 'Adar') return anyCommon;
    if (m === 'Adar I' || m === 'Adar II') return anyLeap;
    return true;
  });
}

// English → Hebrew
function EnglishToHebrew() {
  const { t } = useUserPrefs();
  const [m, setM] = useState<number | ''>('');
  const [d, setD] = useState<number | ''>('');
  const [y, setY] = useState<number | ''>('');
  // Keyed result: only displayed when its key matches the current inputs, so we
  // never need a synchronous setState in the effect to clear stale output.
  const [out, setOut] = useState<{ key: string; text: string } | null>(null);

  // Guard the range so we never fire the API with month 13 / day 40 (which would
  // silently roll over into a plausible-but-wrong date).
  const valid = !!(
    m && d && y &&
    (m as number) >= 1 && (m as number) <= 12 &&
    (d as number) >= 1 && (d as number) <= 31 &&
    (y as number) >= 1 && (y as number) <= 3000
  );
  const key = `${m}-${d}-${y}`;

  useEffect(() => {
    if (!valid) return;
    let active = true;
    fetch(`/api/convert?dir=gToH&m=${m}&d=${d}&y=${y}`)
      .then(r => (r.ok ? r.json() : null))
      .then((res: { hebrew_day: number; hebrew_month: string } | null) => {
        if (active) setOut({ key, text: res ? `${res.hebrew_day} ${res.hebrew_month}` : '—' });
      })
      .catch(() => { if (active) setOut({ key, text: '—' }); });
    return () => { active = false; };
  }, [key, valid, m, d, y]);

  const display = !valid ? null : out && out.key === key ? out.text : '…';

  return (
    <div className="rounded-md border border-warm-border bg-parchment p-4">
      <div className="label mb-2.5">{t('convert.g2h_title')}</div>
      <div dir="ltr" className="flex gap-3">
        <label className="flex-1">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.month')}</span>
          <input type="number" min={1} max={12} value={m} placeholder="MM" className={cell}
            onChange={e => setM(e.target.value ? parseInt(e.target.value) : '')} />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.day')}</span>
          <input type="number" min={1} max={31} value={d} placeholder="DD" className={cell}
            onChange={e => setD(e.target.value ? parseInt(e.target.value) : '')} />
        </label>
        <label className="flex-[2]">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.year')}</span>
          <input type="number" min={1} max={3000} value={y} placeholder="YYYY" className={cell}
            onChange={e => setY(e.target.value ? parseInt(e.target.value) : '')} />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-parchment-card border border-warm-border px-3 py-2.5">
        <span className="text-[10px] text-ink-muted uppercase tracking-wide">{t('convert.hebrew_result')}</span>
        <span className="text-sm font-medium text-ink text-end">
          <ResultValue display={display} placeholder={t('convert.enter_date')} failedText={t('convert.failed')} />
        </span>
      </div>
    </div>
  );
}

// Hebrew → English
function HebrewToEnglish() {
  const { t } = useUserPrefs();
  const [d, setD] = useState<number | ''>('');
  const [hm, setHm] = useState('');
  const [y, setY] = useState<number | ''>('');
  const [out, setOut] = useState<{ key: string; text: string } | null>(null);

  const valid = !!(d && hm && y && (y as number) >= 1 && (y as number) <= 3000);
  const key = `${d}-${hm}-${y}`;

  useEffect(() => {
    if (!valid) return;
    let active = true;
    fetch(`/api/convert?dir=hToG&hd=${d}&hm=${encodeURIComponent(hm)}&y=${y}`)
      .then(r => (r.ok ? r.json() : null))
      .then((res: { month: number; day: number } | null) => {
        if (!active) return;
        if (!res) { setOut({ key, text: '—' }); return; }
        const date = new Date(y as number, res.month - 1, res.day);
        setOut({ key, text: date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) });
      })
      .catch(() => { if (active) setOut({ key, text: '—' }); });
    return () => { active = false; };
  }, [key, valid, d, hm, y]);

  const display = !valid ? null : out && out.key === key ? out.text : '…';

  return (
    <div className="rounded-md border border-warm-border bg-parchment p-4">
      <div className="label mb-2.5">{t('convert.h2g_title')}</div>
      <div dir="ltr" className="flex gap-3">
        <label className="flex-1">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.day')}</span>
          <select value={d} className={cell} onChange={e => setD(e.target.value ? parseInt(e.target.value) : '')}>
            <option value="">–</option>
            {Array.from({ length: 30 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex-[2]">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.hebrew_month')}</span>
          <select value={hm} className={cell} onChange={e => setHm(e.target.value)}>
            <option value="">–</option>
            {selectableMonths(y).map(mo => <option key={mo} value={mo}>{mo}</option>)}
          </select>
        </label>
        <label className="flex-1">
          <span className="block text-[10px] text-ink-faint mb-1 text-center uppercase tracking-wide">{t('convert.year')}</span>
          <input type="number" min={1} max={3000} value={y} placeholder="YYYY" className={cell}
            onChange={e => setY(e.target.value ? parseInt(e.target.value) : '')} />
        </label>
      </div>
      <p className="text-[11px] text-ink-faint mt-1.5">{t('convert.h2g_hint')}</p>
      <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md bg-parchment-card border border-warm-border px-3 py-2.5">
        <span className="text-[10px] text-ink-muted uppercase tracking-wide">{t('convert.english_result')}</span>
        <span className="text-sm font-medium text-ink text-end">
          <ResultValue display={display} placeholder={t('convert.enter_date')} failedText={t('convert.failed')} />
        </span>
      </div>
    </div>
  );
}

export function DateConverterModal({ label }: { label: string }) {
  const { t } = useUserPrefs();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label hover:text-ink flex items-center gap-1.5 transition-colors"
        title={label}
      >
        <span>🔄</span><span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <Modal title={t('convert.title')} onClose={() => setOpen(false)} maxWidth="max-w-md">
          <div className="space-y-4">
            <EnglishToHebrew />
            <HebrewToEnglish />
          </div>
          <div className="flex justify-end pt-5">
            <button type="button" onClick={() => setOpen(false)} className={btnGhost}>{t('convert.done')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
