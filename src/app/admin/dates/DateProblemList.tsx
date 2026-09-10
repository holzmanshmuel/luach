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

/** "10 days earlier than" / "3 days later than" — never a bare signed number. */
function gapPhrase(offsetDays: number): string {
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? 'day' : 'days';
  return `${n} ${unit} ${offsetDays < 0 ? 'earlier' : 'later'}`;
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
        The two dates are{' '}
        <span className="text-ink-2">{p.offset_days !== null ? gapPhrase(p.offset_days) : 'far'}</span>{' '}
        apart. One of them is wrong — which one?
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
