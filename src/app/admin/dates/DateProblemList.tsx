'use client';

import { useState, useTransition } from 'react';
import type { Finding } from '@/lib/date-consistency';
import type { TMessage } from '@/lib/translations';
import { useUserPrefs } from '@/app/components/UserPrefsContext';
import { InterpolatedMany, Message } from '@/app/components/Interpolated';
import { trustEnglishDateAction, trustHebrewDateAction } from './actions';
import { eventTypeLabel, findingDates } from './finding-dates';

/**
 * The list of rows whose two dates disagree, each with the two possible readings
 * and a button per reading.
 *
 * The owner is the only person who knows which of the two dates is the true one,
 * so this deliberately does NOT guess. It states both readings in plain language
 * and asks which is right. Neither button sends a date — each posts only the event
 * id, and the server re-derives the correction from the row itself.
 *
 * Language comes from `useUserPrefs()` (the root layout fills it from the same
 * `lang` cookie the page reads), like every other client component in the app.
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

const GAP_KEYS = {
  earlier: { one: 'dates.gap_earlier_one', many: 'dates.gap_earlier_many' },
  later: { one: 'dates.gap_later_one', many: 'dates.gap_later_many' },
} as const;

/**
 * "The English date is 11 days earlier than the Hebrew date implies." — the SIGN
 * read out loud, never a bare number.
 *
 * `offset_days` is the stored English date minus the date the Hebrew one implies, so
 * a negative gap means the English date sits earlier in the year. Whole sentences
 * per direction and per count, never a phrase dropped into a sentence: an earlier
 * draft assembled the phrase and rendered "31 days earlier apart", and a Hebrew
 * sentence cannot be assembled in English word order at all.
 */
function gapMessage(offsetDays: number): TMessage {
  const n = Math.abs(offsetDays);
  const keys = offsetDays < 0 ? GAP_KEYS.earlier : GAP_KEYS.later;
  return n === 1 ? { key: keys.one } : { key: keys.many, params: { n } };
}

function ProblemRow({ problem: p }: { problem: Finding }) {
  const { t, language } = useUserPrefs();
  const [done, setDone] = useState<'hebrew' | 'english' | null>(null);
  const [error, setError] = useState<TMessage | null>(null);
  const [isPending, start] = useTransition();
  const d = findingDates(p, language);

  function fix(which: 'hebrew' | 'english') {
    setError(null);
    start(async () => {
      const res =
        which === 'hebrew' ? await trustHebrewDateAction(p.id) : await trustEnglishDateAction(p.id);
      if (res.error) setError(res.error);
      else setDone(which);
    });
  }

  const person = (
    <div className="text-sm text-ink">
      <bdi>{p.person_name}</bdi>
    </div>
  );

  if (p.verdict === 'unconvertible') {
    return (
      <div className="py-4">
        {person}
        <p className="text-xs text-ink-muted mt-1">
          <InterpolatedMany
            template={t('dates.unreadable')}
            params={{ hebrew: d.hebrew, english: d.english }}
            valueClassName="text-ink-2"
          />
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="py-4">
        {person}
        <p className="text-xs text-ink-muted mt-1">
          {/* Trusting the Hebrew date rewrites the ENGLISH one, and vice versa. */}
          {t(done === 'hebrew' ? 'dates.fixed_english' : 'dates.fixed_hebrew')}
        </p>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-3">
        {person}
        <div className="label shrink-0">{eventTypeLabel(p.event_type, t)}</div>
      </div>

      <p className="text-xs text-ink-muted mt-1.5">
        {p.offset_days !== null ? (
          <Message t={t} message={gapMessage(p.offset_days)} valueClassName="text-ink-2" />
        ) : (
          t('dates.far_apart')
        )}{' '}
        {t('dates.which_wrong')}
      </p>

      <div className="mt-3 space-y-2.5">
        <Option
          label={t('dates.trust_hebrew')}
          detail={
            <InterpolatedMany
              template={t('dates.trust_hebrew_detail')}
              params={{ hebrew: d.hebrew, expected: d.expected, english: d.english }}
              valueClassName="text-ink-2"
            />
          }
          onClick={() => fix('hebrew')}
          disabled={isPending}
        />
        <Option
          label={t('dates.trust_english')}
          detail={
            <InterpolatedMany
              template={t('dates.trust_english_detail')}
              params={{ english: d.english, falls_on: d.fallsOn, hebrew: d.hebrew }}
              valueClassName="text-ink-2"
            />
          }
          onClick={() => fix('english')}
          disabled={isPending}
        />
      </div>

      {error && (
        <p className="text-xs text-accent mt-2">
          <Message t={t} message={error} />
        </p>
      )}
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
