'use client';

import { useId, useState, useTransition } from 'react';
import { setHebrewNameAction } from '@/app/actions';
import { SAVE_FAILED } from '@/lib/action-errors';
import type { TMessage } from '@/lib/translations';
import { fieldInput } from '@/app/components/Modal';
import { Message } from '@/app/components/Interpolated';
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
  const [error, setError] = useState<TMessage | null>(null);
  const [isPending, start] = useTransition();
  const errorId = useId();
  const cleanName = row.name.replace(/~[^~]+$/, '').replace(/\\/g, '');

  /**
   * The refusal is shown on THIS row, beneath the name it belongs to: several rows
   * are on screen at once, and a banner at the top of the page would not say which
   * spelling failed to save. A rejected action — a dropped connection, a 500 —
   * lands in the catch with the same generic sentence, because the alternative is
   * the bug this row had: the transition ends and nothing on screen changes.
   */
  function confirm() {
    setError(null);
    start(async () => {
      try {
        const res = await setHebrewNameAction({ id: row.id, name_he: value });
        if (res.error) setError(res.error);
        else setStatus('confirmed');
      } catch (err) {
        // Swallowed for the reader, kept for whoever debugs it: the generic
        // sentence is all the owner can act on, but a bare `catch {}` would also
        // throw away the only trace of a 500.
        console.error('setHebrewNameAction failed', err);
        setError(SAVE_FAILED);
      }
    });
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <div className="w-40 shrink-0 text-sm text-ink-2 truncate" title={cleanName}>
          <bdi>{cleanName}</bdi>
        </div>
        <input
          dir="rtl"
          value={value}
          onChange={e => { setValue(e.target.value); setStatus('suggested'); setError(null); }}
          className={`${fieldInput} flex-1`}
          placeholder={t('names.placeholder')}
          // role="alert" announces the refusal once, when it appears. These tie it
          // to the field as well, so someone who tabs back to the box afterwards is
          // told why it is still unsaved instead of finding a silent input.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
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
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[#8C2F26] mt-1.5">
          <Message t={t} message={error} />
        </p>
      )}
    </div>
  );
}
