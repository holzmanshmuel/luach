'use client';

import { useState, useTransition } from 'react';
import { setHebrewNameAction } from '@/app/actions';
import { fieldInput } from '@/app/components/Modal';
import { useUserPrefs } from '@/app/components/UserPrefsContext';

export interface NameRow {
  id: number;
  name: string;
  name_he: string | null;
  name_he_status: string | null;
}

/**
 * One row per person: their stored (usually Latin) name, and an input for the
 * Hebrew spelling. Copy comes from `useUserPrefs().t`; the stored name is DATA and
 * is `<bdi>`-isolated so its punctuation cannot reorder inside a Hebrew row. The
 * Hebrew-name input stays `dir="rtl"` in both languages — its content is always
 * Hebrew, whatever language the page is in.
 */
export function ReviewNamesPanel({ rows }: { rows: NameRow[] }) {
  return (
    <div className="border-y border-warm-border divide-y divide-warm-border/60">
      {rows.map(r => (
        <Row key={r.id} row={r} />
      ))}
    </div>
  );
}

function Row({ row }: { row: NameRow }) {
  const { t } = useUserPrefs();
  const [value, setValue] = useState(row.name_he ?? '');
  const [status, setStatus] = useState(row.name_he_status);
  const [isPending, start] = useTransition();
  const cleanName = row.name.replace(/~[^~]+$/, '').replace(/\\/g, '');

  function confirm() {
    start(async () => {
      const res = await setHebrewNameAction({ id: row.id, name_he: value });
      if (!res.error) setStatus('confirmed');
    });
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-40 shrink-0 text-sm text-ink-2 truncate" title={cleanName}>
        <bdi>{cleanName}</bdi>
      </div>
      <input
        dir="rtl"
        value={value}
        onChange={e => { setValue(e.target.value); setStatus('suggested'); }}
        className={`${fieldInput} flex-1`}
        placeholder={t('names.placeholder')}
      />
      <span className="w-16 shrink-0 text-[10px] text-end">
        {status === 'confirmed'
          ? <span className="text-ink-faint">{t('names.confirmed')}</span>
          : status === 'suggested'
            ? <span className="text-accent-ink">{t('names.suggested')}</span>
            : null}
      </span>
      <button
        onClick={confirm}
        disabled={isPending}
        className="text-xs rounded-full border border-warm-border px-3 py-1.5 text-ink-muted hover:bg-parchment-dark disabled:opacity-50 transition-colors shrink-0"
      >
        {isPending ? '…' : t('names.confirm')}
      </button>
    </div>
  );
}
