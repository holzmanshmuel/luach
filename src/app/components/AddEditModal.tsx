'use client';

import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import { CalendarEvent, EVENT_TYPES, EventType, HEBREW_MONTHS } from '@/lib/types';
import { Modal, fieldLabel, fieldInput, btnPrimary, btnGhost } from './Modal';
import { useUserPrefs } from './UserPrefsContext';
import { monthOptionLabel } from '@/lib/date-format';
import { fullName } from '@/lib/names';
import { createEventAction, updateEventAction, deleteEventAction, getAllFamilyMembers } from '@/app/actions';

// Client-side Gregorian→Hebrew conversion via a tiny API route rather than
// bundling @hebcal/core into the client. The Hebrew date is always derived from
// the English date the user enters — it is never typed directly.
async function convertGregorianToHebrew(
  month: number, day: number, year: number
): Promise<{ hebrew_day: number; hebrew_month: string } | null> {
  try {
    const res = await fetch(`/api/convert?dir=gToH&m=${month}&d=${day}&y=${year}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

interface Props {
  mode: 'create' | 'edit';
  event?: CalendarEvent;
  onClose?: () => void;
}

const dateCellInput =
  'w-full bg-transparent border-b border-warm-border focus:border-accent py-1.5 text-ink text-sm text-center outline-none transition-colors';

export function AddEditModal({ mode, event, onClose }: Props) {
  const { t, isAdmin, language, branches } = useUserPrefs();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [converting, setConverting] = useState(false);

  // Form fields
  const [name, setName] = useState(event?.name ?? '');
  const [branch, setBranch] = useState(event?.family_branch ?? '');
  const [eventType, setEventType] = useState<EventType>(event?.event_type ?? 'birthday');
  const [eventTypeLabel, setEventTypeLabel] = useState(event?.event_type_label ?? '');
  const [hebrewDay, setHebrewDay] = useState<number | ''>(event?.hebrew_day ?? '');
  const [hebrewMonth, setHebrewMonth] = useState(event?.hebrew_month ?? '');
  // Pre-fill the Gregorian fields when editing an event with a stored English date.
  const initGreg = (() => {
    if (event?.original_english_date) {
      const d = new Date(event.original_english_date);
      return { m: d.getUTCMonth() + 1 as number | '', d: d.getUTCDate() as number | '', y: d.getUTCFullYear() as number | '' };
    }
    return { m: '' as number | '', d: '' as number | '', y: (event?.gregorian_year ?? '') as number | '' };
  })();
  const [gregYear, setGregYear] = useState<number | ''>(initGreg.y);
  const [gregMonth, setGregMonth] = useState<number | ''>(initGreg.m);
  const [gregDay, setGregDay] = useState<number | ''>(initGreg.d);
  const [note, setNote] = useState(event?.note ?? '');

  // Member picker (create mode): pick an existing person by name so a typo can't
  // fork a duplicate. memberId links the event to that person by id; left unset,
  // a new person is created from the typed name.
  const [members, setMembers] = useState<{ id: number; name: string; family_branch: string | null }[]>([]);
  const [memberId, setMemberId] = useState<number | undefined>(undefined);
  const [showSuggest, setShowSuggest] = useState(false);
  useEffect(() => {
    if (open && mode === 'create' && members.length === 0) {
      getAllFamilyMembers()
        .then(ms => setMembers(ms.map(m => ({ id: m.id, name: fullName(m), family_branch: m.family_branch }))))
        .catch(() => { /* the name field still works as free text */ });
    }
  }, [open, mode, members.length]);
  const nameMatches = name.trim()
    ? members.filter(m => m.name.toLowerCase().includes(name.trim().toLowerCase())).slice(0, 6)
    : [];
  const exactMatch = members.find(m => m.name.toLowerCase() === name.trim().toLowerCase());

  // NOTE: legacy events (a Hebrew date + birth year but no stored English date)
  // deliberately open with the English fields blank and the Hebrew date shown in
  // the editable Hebrew fields. We do NOT back-derive an English date from the
  // Hebrew date — that round-trip clamps 30→29 in short months and collapses Adar
  // labels, so promoting it to an authoritative English date on save silently
  // shifted the recurring date. The Hebrew date is the source of truth here.

  function resetForm() {
    setName(event?.name ?? '');
    setBranch(event?.family_branch ?? '');
    setEventType(event?.event_type ?? 'birthday');
    setEventTypeLabel(event?.event_type_label ?? '');
    setHebrewDay(event?.hebrew_day ?? '');
    setHebrewMonth(event?.hebrew_month ?? '');
    setGregYear(initGreg.y); setGregMonth(initGreg.m); setGregDay(initGreg.d);
    setNote(event?.note ?? '');
    setConverting(false);
    setMemberId(undefined);
    setShowSuggest(false);
    englishDirty.current = false;
  }

  function handleClose() {
    setOpen(false);
    setError(null);
    setConfirmDelete(false);
    resetForm(); // discard unsaved edits so a reopen doesn't show stale values
    onClose?.();
  }

  // Bumped on every English-date change so an out-of-order conversion response
  // (e.g. an earlier, slower request) can't overwrite a newer one — otherwise the
  // saved recurring Hebrew date could silently mismatch the entered English date.
  const convReq = useRef(0);
  // True once the user actually edits the English date — only then does the server
  // (re)derive the Hebrew recurrence from it. Editing the Hebrew date directly sets
  // this false, so the English (birth) date is kept, not wiped, and the manual
  // Hebrew date wins.
  const englishDirty = useRef(false);
  const handleGregorianChange = useCallback(async (
    m: number | '', d: number | '', y: number | ''
  ) => {
    englishDirty.current = true;
    setGregMonth(m); setGregDay(d); setGregYear(y);
    // Only recompute once the English date is complete. While it's incomplete we
    // leave the Hebrew fields as-is so a directly-entered Hebrew date isn't wiped.
    if (!m || !d || !y || y < 1800 || y > 2100) return;

    const reqId = ++convReq.current;
    setConverting(true);
    const result = await convertGregorianToHebrew(m as number, d as number, y as number);
    if (reqId !== convReq.current) return; // superseded by a newer change — ignore
    setConverting(false);
    if (result) {
      setHebrewDay(result.hebrew_day);
      setHebrewMonth(result.hebrew_month);
    }
  }, []);

  // Editing the Hebrew date directly makes IT the source of truth (a manual
  // override). We keep the stored English date rather than blanking it — the server
  // won't re-derive because englishDirty is now false — so nudging the Hebrew day no
  // longer silently erases the birth date.
  /* eslint-disable react-hooks/immutability -- false positive: plain ref mutations
     (englishDirty/convReq .current), identical to ref writes elsewhere in this file
     that the rule does NOT flag. react-hooks@7.0.1's experimental immutability rule
     fires inconsistently (suppressing one write just shifts it to the next ref in the
     same handler). Behavior is intentional — see the comment above; do not rewrite. */
  function handleHebrewEdit(day: number | '', month: string) {
    englishDirty.current = false;
    setHebrewDay(day);
    setHebrewMonth(month);
    convReq.current++; // cancel any in-flight English→Hebrew conversion
    setConverting(false);
  }
  /* eslint-enable react-hooks/immutability */

  // ISO value for the native date input — only when all three parts are present.
  const gregISO = (gregYear && gregMonth && gregDay)
    ? `${String(gregYear).padStart(4, '0')}-${String(gregMonth).padStart(2, '0')}-${String(gregDay).padStart(2, '0')}`
    : '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const hasEnglish = !!(gregMonth && gregDay && gregYear);
    if (hasEnglish && (gregYear < 1800 || gregYear > 2100)) {
      setError(t('form.err_year_range'));
      return;
    }

    // Creating a new occasion always starts from a full English date. Editing an
    // existing one can be done with the Hebrew date alone (it's the recurring
    // date), so the English date is optional there.
    if (mode === 'create' && !hasEnglish) {
      setError(t('form.err_full_english'));
      return;
    }

    // The server re-derives the Hebrew date from the English date only when the
    // English date was actually edited; otherwise the (pre-filled or directly
    // edited) Hebrew date is used as-is.
    const deriveFromEnglish = englishDirty.current && hasEnglish;

    // When not deriving, a Hebrew date must be present (it drives the recurrence).
    if (!deriveFromEnglish && (!hebrewDay || !hebrewMonth)) {
      setError(converting ? t('form.err_calculating') : t('form.err_hebrew_or_english'));
      return;
    }

    // Preserve the English (birth) date whenever the fields hold one — even on a
    // Hebrew-only edit — so it isn't lost.
    let englishDate: string | undefined;
    if (hasEnglish) {
      const m = String(gregMonth).padStart(2, '0');
      const d = String(gregDay).padStart(2, '0');
      englishDate = `${gregYear}-${m}-${d}`;
    }

    const data = {
      name,
      // Link by id: the explicitly-picked member, or — if the typed name exactly
      // matches an existing person — that person, so typing (not clicking) an exact
      // name still links instead of forking a duplicate.
      family_member_id: mode === 'create' ? (memberId ?? exactMatch?.id) : undefined,
      family_branch: branch,
      event_type: eventType,
      event_type_label: eventType === 'other' ? eventTypeLabel : undefined,
      deriveFromEnglish,
      // When an English date is present the server re-derives the Hebrew date from
      // it (authoritative); otherwise these directly-entered values are used.
      hebrew_day: hebrewDay as number,
      hebrew_month: hebrewMonth,
      // Editing the Hebrew date directly (no English date) preserves the stored
      // birth year — it's independent of which representation was edited — so an
      // unrelated tweak never silently wipes the age/"Nth" info.
      gregorian_year: hasEnglish ? (gregYear as number) : (event?.gregorian_year ?? undefined),
      original_english_date: englishDate,
      note: note || undefined,
    };

    startTransition(async () => {
      const result = mode === 'create'
        ? await createEventAction(data)
        : await updateEventAction(event!.id, data);

      if (result.error) {
        setError(result.error);
      } else {
        handleClose();
      }
    });
  }

  function handleDelete() {
    if (!event) return;
    startTransition(async () => {
      const result = await deleteEventAction(event.id);
      if (result.error) setError(result.error);
      else handleClose();
    });
  }

  const triggerButton = mode === 'create' ? (
    <button
      onClick={() => setOpen(true)}
      className="sig-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
    >
      + {t('action.add_event')}
    </button>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="text-sm text-accent-ink hover:text-ink transition-colors"
    >
      {t('action.edit_event')}
    </button>
  );

  return (
    <>
      {triggerButton}

      {open && (
        <Modal title={mode === 'create' ? t('action.add_event') : t('action.edit_event')} onClose={handleClose} closeOnBackdrop={false}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name — a searchable member picker in create mode so a typo doesn't
                fork a duplicate person; a plain field in edit mode. */}
            <div className="relative">
              <label className={fieldLabel} htmlFor="ae-name">{t('person.name')} *</label>
              <input
                id="ae-name"
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setMemberId(undefined); setShowSuggest(true); }}
                onFocus={() => mode === 'create' && setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                required
                autoComplete="off"
                placeholder={t('form.name_placeholder')}
                className={fieldInput}
              />
              {mode === 'create' && showSuggest && nameMatches.length > 0 && !memberId && (
                <ul className="absolute z-20 left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded-md border border-warm-border bg-parchment-card shadow-lg">
                  {nameMatches.map(m => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setName(m.name); setMemberId(m.id); setShowSuggest(false); }}
                        className="w-full text-start px-3 py-1.5 text-sm text-ink hover:bg-parchment-dark flex items-center gap-2"
                      >
                        <span>{m.name}</span>
                        {m.family_branch && <span className="text-[10px] text-ink-faint">· {m.family_branch}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'create' && name.trim() && (
                memberId ? (
                  <p className="text-[11px] text-accent-ink mt-1"><bdi>{name.trim()}</bdi> · {t('form.member_linked')}</p>
                ) : exactMatch ? (
                  <p className="text-[11px] text-amber-700 mt-1">{t('form.member_exists')}</p>
                ) : (
                  <p className="text-[11px] text-ink-faint mt-1">{t('form.member_new')}</p>
                )
              )}
            </div>

            {/* Family branch — only when creating a NEW person. Once linked to an
                existing member, the branch is theirs (the server ignores it here),
                so we hide the control rather than let it silently do nothing. */}
            {mode === 'create' && !memberId && (
              <div>
                <label className={fieldLabel}>{t('person.branch')}</label>
                <select aria-label={t('person.branch')} value={branch} onChange={e => setBranch(e.target.value)} className={fieldInput}>
                  <option value="">{t('form.select_branch')}</option>
                  {branches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Event type */}
            <div>
              <label className={fieldLabel}>{t('form.event_type')} *</label>
              <select
                aria-label={t('form.event_type')}
                value={eventType}
                onChange={e => setEventType(e.target.value as EventType)}
                className={fieldInput}
              >
                {EVENT_TYPES.map(et => (
                  <option key={et.value} value={et.value}>{et.icon} {t(`event.${et.value}`)}</option>
                ))}
              </select>
            </div>

            {/* Free-text label for "Other" */}
            {eventType === 'other' && (
              <div>
                <label className={fieldLabel}>{t('form.describe_event')} *</label>
                <input
                  type="text"
                  value={eventTypeLabel}
                  onChange={e => setEventTypeLabel(e.target.value)}
                  required
                  placeholder={t('form.describe_placeholder')}
                  className={fieldInput}
                />
              </div>
            )}

            {/* Date. The Hebrew date is the recurring date; typing an English date
                fills it in automatically. On edit the English date is optional —
                the Hebrew date alone can be adjusted directly. */}
            <div className="rounded-md border border-warm-border bg-parchment p-4 space-y-3">
              <div className="label">
                {t('form.english_date')} {mode === 'create'
                  ? '*'
                  : <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span>}
                {converting && <span className="text-accent-ink normal-case tracking-normal"> · {t('form.calculating')}</span>}
              </div>
              {/* One native date picker: it renders in the user's own locale order
                  (no US-vs-Israeli MM/DD-vs-DD/MM ambiguity), only emits real dates
                  (Feb 30 is impossible), and is easy to use on a phone. */}
              <input
                type="date"
                min="1800-01-01" max="2100-12-31"
                required={mode === 'create'}
                value={gregISO}
                onChange={e => {
                  const v = e.target.value; // 'YYYY-MM-DD' or ''
                  if (!v) { handleGregorianChange('', '', ''); return; }
                  const [y, m, d] = v.split('-').map(Number);
                  handleGregorianChange(m, d, y);
                }}
                className={`${fieldInput} py-1.5`}
              />

              {/* Recurring Hebrew date — editable. Auto-filled from the English date
                  above, or adjust it directly (it's what the event repeats on). */}
              <div className="rounded-md bg-parchment-card border border-warm-border px-3 py-2.5 space-y-2">
                <span className="text-[10px] text-ink-muted uppercase tracking-wide">{t('form.hebrew_recurring')}</span>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="number" min={1} max={30}
                      value={hebrewDay}
                      onChange={e => handleHebrewEdit(e.target.value ? parseInt(e.target.value) : '', hebrewMonth)}
                      placeholder={t('form.day')}
                      aria-label={t('form.day')}
                      className={dateCellInput}
                    />
                  </div>
                  <div className="flex-[2]">
                    <select
                      value={hebrewMonth}
                      onChange={e => handleHebrewEdit(hebrewDay, e.target.value)}
                      aria-label={t('form.month')}
                      className={dateCellInput}
                    >
                      <option value="">{t('form.month_select')}</option>
                      {HEBREW_MONTHS.map(m => (
                        <option key={m} value={m}>{monthOptionLabel(m, language)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                {mode === 'create' ? t('form.hebrew_help_create') : t('form.hebrew_help_edit')}
              </p>
            </div>

            {/* Note */}
            <div>
              <label className={fieldLabel}>{t('form.note')} <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span></label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('form.note_placeholder')}
                className={fieldInput}
              />
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={isPending || converting} className={`${btnPrimary} flex-1`}>
                {isPending ? t('person.saving') : converting ? t('form.calculating_btn') : mode === 'create' ? t('form.add_event_btn') : t('form.save_changes')}
              </button>
              <button type="button" onClick={handleClose} className={`${btnGhost} flex-1`}>
                {t('person.cancel')}
              </button>
            </div>

            {mode === 'edit' && isAdmin && (
              <div className="pt-3 border-t border-warm-border">
                {!confirmDelete ? (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-red-700 hover:text-red-900 transition-colors">
                    {t('form.delete_event')}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-ink-muted">{t('form.confirm_sure')}</span>
                    <button type="button" onClick={handleDelete} disabled={isPending} className="text-sm text-red-700 font-medium hover:text-red-900 disabled:opacity-50">{t('form.yes_delete')}</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm text-ink-muted hover:text-ink">{t('person.cancel')}</button>
                  </div>
                )}
              </div>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
