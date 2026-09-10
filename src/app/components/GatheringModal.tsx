'use client';

import { useState, useTransition } from 'react';
import { Gathering, GatheringKind, GATHERING_KINDS, GATHERING_KIND_ICON, FamilyTag } from '@/lib/types';
import { Modal, fieldLabel, fieldInput, btnPrimary, btnGhost } from './Modal';
import { useUserPrefs } from './UserPrefsContext';
import { formatCivilDayLocalized } from '@/lib/date-format';
import {
  createGatheringAction,
  updateGatheringAction,
  deleteGatheringAction,
} from '@/app/actions';

/** Format 'HH:MM' (24h) to a short local-ish label, e.g. "7:30 PM". Mirrors the
 *  identical helper in GatheringChip — kept file-local rather than shared to
 *  avoid a circular import (GatheringChip imports this module). */
function fmtTime(time: string | null, lang: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  mode: 'create' | 'edit';
  gathering?: Gathering;
  /** Render-prop trigger; receives an `open` callback. Defaults to a button. */
  onClose?: () => void;
  open?: boolean;
  controlled?: boolean;
  /** Combined (merged) view only — render static details + a "switch to edit"
   *  form instead of the editable form/delete. Requires `family` below. */
  readOnly?: boolean;
  /** Which family this gathering belongs to, in combined (merged) view. */
  family?: FamilyTag;
}

export function GatheringModal({ mode, gathering, onClose, open: openProp, controlled, readOnly, family }: Props) {
  const { t, isAdmin, language } = useUserPrefs();
  const [openState, setOpen] = useState(false);
  const open = controlled ? !!openProp : openState;
  const familyLabel = family
    ? (language === 'he' && family.nameHe ? family.nameHe : family.name)
    : null;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [title, setTitle] = useState(gathering?.title ?? '');
  const [kind, setKind] = useState<GatheringKind>(gathering?.kind ?? 'wedding');
  const [date, setDate] = useState(gathering?.gather_date ?? '');
  const [time, setTime] = useState(gathering?.gather_time ?? '');
  const [location, setLocation] = useState(gathering?.location ?? '');
  const [description, setDescription] = useState(gathering?.description ?? '');

  function close() {
    setError(null);
    setConfirmDelete(false);
    if (controlled) onClose?.();
    else {
      // reset to the original values so a reopen is clean
      setTitle(gathering?.title ?? '');
      setKind(gathering?.kind ?? 'wedding');
      setDate(gathering?.gather_date ?? '');
      setTime(gathering?.gather_time ?? '');
      setLocation(gathering?.location ?? '');
      setDescription(gathering?.description ?? '');
      setOpen(false);
    }
    onClose?.();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError(t('gathering.err_title')); return; }
    if (!date) { setError(t('gathering.err_date')); return; }
    setError(null);
    const data = {
      title: title.trim(),
      kind,
      gather_date: date,
      gather_time: time || null,
      location: location.trim() || null,
      description: description.trim() || null,
    };
    startTransition(async () => {
      const result = mode === 'create'
        ? await createGatheringAction(data)
        : await updateGatheringAction(gathering!.id, data);
      if (result.error) setError(result.error);
      else close();
    });
  }

  function handleDelete() {
    if (!gathering) return;
    startTransition(async () => {
      const result = await deleteGatheringAction(gathering.id);
      if (result.error) setError(result.error);
      else close();
    });
  }

  return (
    <>
      {!controlled && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-warm-border bg-parchment-card px-4 py-2 text-sm font-medium text-ink hover:bg-parchment-dark transition-colors"
        >
          🎉 {t('gathering.add')}
        </button>
      )}

      {open && (
        <Modal title={mode === 'create' ? t('gathering.add') : t('gathering.edit')} onClose={close} closeOnBackdrop={false}>
          {readOnly && gathering ? (
            <div className="space-y-4">
              {family && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-warm-border text-ink-muted inline-flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: family.color }}
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    aria-hidden
                  />
                  {familyLabel}
                </span>
              )}

              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span aria-hidden>{GATHERING_KIND_ICON[gathering.kind]}</span>
                <span className="font-medium">{t(`gathering.kind.${gathering.kind}`)}</span>
              </div>

              <div>
                <div className={fieldLabel}>{t('gathering.title_label')}</div>
                <div className="font-display text-lg text-ink"><bdi>{gathering.title}</bdi></div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <div className={fieldLabel}>{t('gathering.date_label')}</div>
                  <div className="text-sm text-ink">
                    {/* gather_date is already a YYYY-MM-DD civil day (to_char in
                        SQL) — format it as one. Round-tripping it through a
                        browser Date is how a calendar day acquires a timezone. */}
                    {formatCivilDayLocalized(gathering.gather_date, language)}
                  </div>
                </div>
                {gathering.gather_time && (
                  <div className="flex-1">
                    <div className={fieldLabel}>{t('gathering.time_label')}</div>
                    <div className="text-sm text-ink">{fmtTime(gathering.gather_time, language)}</div>
                  </div>
                )}
              </div>

              {gathering.location && (
                <div>
                  <div className={fieldLabel}>{t('gathering.location_label')}</div>
                  <div className="text-sm text-ink">{gathering.location}</div>
                </div>
              )}

              {gathering.description && (
                <div>
                  <div className={fieldLabel}>{t('gathering.desc_label')}</div>
                  <div className="text-sm text-ink-muted whitespace-pre-wrap">{gathering.description}</div>
                </div>
              )}

              {family && (
                <div className="pt-3 border-t border-warm-border">
                  <p className="text-xs text-ink-muted mb-2">
                    {t('combined.edit_elsewhere').replace('{name}', familyLabel!)}
                  </p>
                  <form method="post" action="/api/family/switch" className="flex justify-end">
                    <input type="hidden" name="familyId" value={family.id} />
                    <button type="submit" className="text-sm text-accent-ink hover:text-ink transition-colors">
                      {t('combined.switch_to').replace('{name}', familyLabel!)}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={fieldLabel}>{t('gathering.kind_label')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {GATHERING_KINDS.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={kind === k}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        kind === k
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-900 font-medium'
                          : 'border-warm-border bg-parchment-card text-ink-2 hover:bg-parchment-dark'
                      }`}
                    >
                      <span aria-hidden>{GATHERING_KIND_ICON[k]}</span>
                      {t(`gathering.kind.${k}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={fieldLabel}>{t('gathering.title_label')} *</label>
                <input
                  type="text" value={title} onChange={e => setTitle(e.target.value)}
                  required placeholder={t('gathering.title_placeholder')} className={fieldInput}
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={fieldLabel}>{t('gathering.date_label')} *</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} required className={fieldInput} />
                </div>
                <div className="flex-1">
                  <label className={fieldLabel}>{t('gathering.time_label')}</label>
                  <input type="time" value={time} onChange={e => setTime(e.target.value)} className={fieldInput} />
                </div>
              </div>

              <div>
                <label className={fieldLabel}>{t('gathering.location_label')}</label>
                <input
                  type="text" value={location} onChange={e => setLocation(e.target.value)}
                  placeholder={t('gathering.location_placeholder')} className={fieldInput}
                />
              </div>

              <div>
                <label className={fieldLabel}>{t('gathering.desc_label')}</label>
                <textarea
                  value={description} onChange={e => setDescription(e.target.value)} rows={2}
                  placeholder={t('gathering.desc_placeholder')}
                  className={`${fieldInput} resize-none`}
                />
              </div>

              {error && <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={isPending} className={`${btnPrimary} flex-1`}>
                  {isPending ? t('person.saving') : mode === 'create' ? t('gathering.save') : t('person.save')}
                </button>
                <button type="button" onClick={close} className={`${btnGhost} flex-1`}>{t('person.cancel')}</button>
              </div>

              {mode === 'edit' && isAdmin && (
                <div className="pt-3 border-t border-warm-border">
                  {!confirmDelete ? (
                    <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-red-700 hover:text-red-900 transition-colors">
                      {t('gathering.delete')}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-ink-muted">{t('gathering.confirm_delete')}</span>
                      <button type="button" onClick={handleDelete} disabled={isPending} className="text-sm text-red-700 font-medium hover:text-red-900 disabled:opacity-50">{t('gathering.yes_delete')}</button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm text-ink-muted hover:text-ink">{t('person.cancel')}</button>
                    </div>
                  )}
                </div>
              )}
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
