'use client';

import { CalendarEvent } from '@/lib/types';
import { AddEditModal } from './AddEditModal';
import { useUserPrefs } from './UserPrefsContext';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { eventStyle } from '@/lib/event-style';
import { displayName } from '@/lib/names';
import { formatHebrewDateLocalized, formatGregorianLocalized } from '@/lib/date-format';
import { countLabel } from '@/lib/event-phrase';

interface Props {
  event: CalendarEvent;
  onClose: () => void;
}

export function EventDetailModal({ event, onClose }: Props) {
  const { showNicknames, t, language, canEdit, spell } = useUserPrefs();
  const isHebrew = event.dateType === 'hebrew';
  const style = eventStyle(event.event_type);

  const rawName = event.name.replace(/\\/g, '');
  const name = displayName(event, language, showNicknames);
  const typeLabel = event.event_type_label || t(`event.${event.event_type}`);
  const hebrewDate = formatHebrewDateLocalized(event.hebrew_day, event.hebrew_month, event.hebrew_year, language);

  // Combined (merged) view only — which family this occurrence belongs to.
  // Absent in single-family mode, so everything gated on it below is a no-op there.
  const familyLabel = event.family
    ? (language === 'he' && event.family.nameHe ? event.family.nameHe : event.family.name)
    : null;

  // Yahrzeit enrichment: how many years since passing, and the evening before
  // (a yahrzeit — and the candle — begins at sunset the prior evening).
  const isYahrzeit = event.event_type === 'yahrtzeit';
  // Nth count is computed server-side in Hebrew years (correct across Jan 1).
  const yahrzeitYears = isYahrzeit ? (event.yearsCount ?? null) : null;
  // The Nth count for birthdays/anniversaries (yahrzeit has its own memorial pack
  // below). e.g. "9th birthday" / "יום הולדת 9".
  const ageLabel = isYahrzeit ? null : countLabel(event.event_type, event.yearsCount, language);
  const eveBefore = new Date(event.gregorianDate);
  eveBefore.setDate(eveBefore.getDate() - 1);
  const ordEn = (n: number) => {
    const m100 = n % 100;
    if (m100 >= 11 && m100 <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };

  return (
    <Modal
      onClose={onClose}
      maxWidth="max-w-sm"
      title={
        <span className="flex items-center gap-3">
          <Avatar name={rawName} photoUrl={event.photo_url} branch={event.family_branch} size="md" />
          <bdi>{name}</bdi>
        </span>
      }
    >
      {event.family && (
        <div className="mb-4">
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-warm-border text-ink-muted inline-flex items-center gap-1.5">
            <span
              style={{ backgroundColor: event.family.color }}
              className="inline-block w-2 h-2 rounded-full shrink-0"
              aria-hidden
            />
            {familyLabel}
          </span>
        </div>
      )}

      {event.family_branch && (
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-warm-border text-ink-muted inline-block mb-4">
          {spell(event.family_branch)}
        </span>
      )}

      {/* Event type + which date drives it */}
      <div className="flex items-center gap-2 mb-4 text-sm text-ink-2">
        <span aria-hidden>{style.icon}</span>
        <span className="font-medium">{typeLabel}</span>
        <span className="text-ink-faint">· {isHebrew ? t('event.hebrew') : t('event.english')}</span>
        {ageLabel && <span className="text-ink-faint">· {ageLabel}</span>}
      </div>

      {/* Date details */}
      <div className="bg-parchment rounded-md border border-warm-border p-3 space-y-2.5 mb-3">
        {isHebrew ? (
          <>
            <div>
              <div className="label mb-0.5">{t('detail.hebrew_date')}</div>
              <div className="font-display text-lg text-ink">{hebrewDate}</div>
            </div>
            <div>
              <div className="label mb-0.5">{t('detail.falls_on')}</div>
              <div className="text-sm text-ink-muted">
                {formatGregorianLocalized(event.gregorianDate, language)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="label mb-0.5">{t('detail.english_date')}</div>
              <div className="font-display text-lg text-ink">
                {formatGregorianLocalized(event.gregorianDate, language)}
              </div>
            </div>
            <div>
              <div className="label mb-0.5">{t('detail.hebrew_date')}</div>
              <div className="text-sm text-ink-muted">{hebrewDate}</div>
            </div>
          </>
        )}
      </div>

      {/* Countdown */}
      {event.daysUntil === 0 ? (
        <div className="text-accent-ink font-semibold bg-accent-soft/50 rounded-md px-3 py-2 text-sm mb-3">
          {t('today')}! 🎉
        </div>
      ) : event.daysUntil > 0 ? (
        <div className="text-xs text-ink-muted mb-3">
          {t('in_days').replace('{n}', String(event.daysUntil))}
        </div>
      ) : null}

      {/* Yahrzeit memorial pack — year count + candle-lighting guidance */}
      {isYahrzeit && (
        <div className="bg-[#EAE0D2]/60 border border-[#D6C5AC] rounded-md p-3 mb-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-ink">
            <span aria-hidden>🕯️</span>
            <span className="font-medium">
              {yahrzeitYears && yahrzeitYears > 0
                ? t('yahrzeit.years').replace('{n}', language === 'he' ? String(yahrzeitYears) : ordEn(yahrzeitYears))
                : t('yahrzeit.in_memory')}
            </span>
          </div>
          <p className="text-xs text-ink-muted leading-relaxed">
            {t('yahrzeit.candle').replace('{date}', formatGregorianLocalized(eveBefore, language))}
          </p>
        </div>
      )}

      {event.note && (
        <div className="text-ink-muted italic text-sm mb-3">{event.note}</div>
      )}

      {canEdit && (
        event.family ? (
          <div className="pt-3 border-t border-warm-border">
            <p className="text-xs text-ink-muted mb-2">
              {t('combined.edit_elsewhere').replace('{name}', familyLabel!)}
            </p>
            <form method="post" action="/api/family/switch" className="flex justify-end">
              <input type="hidden" name="familyId" value={event.family.id} />
              <button type="submit" className="text-sm text-accent-ink hover:text-ink transition-colors">
                {t('combined.switch_to').replace('{name}', familyLabel!)}
              </button>
            </form>
          </div>
        ) : (
          <div className="pt-3 border-t border-warm-border flex justify-end">
            <AddEditModal mode="edit" event={event} onClose={onClose} />
          </div>
        )
      )}
    </Modal>
  );
}
