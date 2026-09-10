'use client';

import { useState, useTransition } from 'react';
import type { Finding } from '@/lib/date-consistency';
import { trustEnglishDateAction, trustHebrewDateAction } from './actions';

/**
 * The list of rows whose two dates disagree, each with the two possible readings
 * and a button per reading.
 *
 * The owner is the only person who knows which of the two dates is the true one,
 * so this deliberately does NOT guess. It states both readings in plain language
 * and asks which is right. Neither button sends a date — each posts only the event
 * id, and the server re-derives the correction from the row itself.
 */
export function DateProblemList({ problems }: { problems: Finding[] }) {
  return (
    <div className="border-y border-warm-border divide-y divide-warm-border/60">
      {problems.map(p => (
        <ProblemRow key={p.id} problem={p} />
      ))}
    </div>
  );
}

/**
 * "11 days earlier" / "1 day later" — the SIGN read out loud, never a bare number.
 *
 * `offset_days` is the stored English date minus the date the Hebrew one implies, so
 * a negative gap means the English date sits earlier in the year. The phrase has to
 * complete "The English date is ___ than the Hebrew date implies", which is why it
 * carries no "apart" — an earlier draft rendered "31 days earlier apart".
 */
function gapPhrase(offsetDays: number): string {
  const n = Math.abs(offsetDays);
  return `${n} ${n === 1 ? 'day' : 'days'} ${offsetDays < 0 ? 'earlier' : 'later'}`;
}

function ProblemRow({ problem: p }: { problem: Finding }) {
  const [done, setDone] = useState<'hebrew' | 'english' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function fix(which: 'hebrew' | 'english') {
    setError(null);
    start(async () => {
      const res =
        which === 'hebrew' ? await trustHebrewDateAction(p.id) : await trustEnglishDateAction(p.id);
      if (res.error) setError(res.error);
      else setDone(which);
    });
  }

  if (p.verdict === 'unconvertible') {
    return (
      <div className="py-4">
        <div className="text-sm text-ink">{p.person_name}</div>
        <p className="text-xs text-ink-muted mt-1">
          Could not read these dates: <span className="text-ink-2">{p.stored_hebrew}</span> and{' '}
          <span className="text-ink-2">{p.stored_english ?? '—'}</span>. Open this person on the
          family tree and re-enter the date.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="py-4">
        <div className="text-sm text-ink">{p.person_name}</div>
        <p className="text-xs text-ink-muted mt-1">
          Fixed — the {done === 'hebrew' ? 'English' : 'Hebrew'} date now matches the{' '}
          {done === 'hebrew' ? 'Hebrew' : 'English'} one. Reload to re-check.
        </p>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm text-ink">{p.person_name}</div>
        <div className="label shrink-0">{p.event_type}</div>
      </div>

      <p className="text-xs text-ink-muted mt-1.5">
        {p.offset_days !== null ? (
          <>
            The English date is{' '}
            <span className="text-ink-2">{gapPhrase(p.offset_days)}</span> than the Hebrew date
            implies.
          </>
        ) : (
          'These two dates are far apart.'
        )}{' '}
        One of them is wrong — which one?
      </p>

      <div className="mt-3 space-y-2.5">
        <Option
          label="The Hebrew date is right"
          detail={
            <>
              <span className="text-ink-2">{p.stored_hebrew}</span> fell on{' '}
              <span className="text-ink-2">{p.expected_english}</span>, so the English date should be
              that instead of <span className="text-ink-2">{p.stored_english}</span>.
            </>
          }
          onClick={() => fix('hebrew')}
          disabled={isPending}
        />
        <Option
          label="The English date is right"
          detail={
            <>
              <span className="text-ink-2">{p.stored_english}</span> was actually{' '}
              <span className="text-ink-2">{p.english_falls_on}</span>, so the Hebrew date should be
              that instead of <span className="text-ink-2">{p.stored_hebrew}</span>.
            </>
          }
          onClick={() => fix('english')}
          disabled={isPending}
        />
      </div>

      {error && <p className="text-xs text-accent mt-2">{error}</p>}
    </div>
  );
}

function Option({
  label,
  detail,
  onClick,
  disabled,
}: {
  label: string;
  detail: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-start rounded-md border border-warm-border px-3 py-2.5 hover:bg-parchment-dark disabled:opacity-50 transition-colors"
    >
      <div className="text-sm text-ink">{label}</div>
      <div className="text-xs text-ink-muted mt-0.5">{detail}</div>
    </button>
  );
}
