'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { EVENT_TYPES, EventType } from '@/lib/types';
import { Modal, fieldLabel, fieldInput, btnPrimary, btnGhost } from './Modal';
import { useUserPrefs } from './UserPrefsContext';
import { createPersonAction, createEventAction, getAllFamilyMembers } from '@/app/actions';
import { cleanName } from '@/lib/names';

interface SimpleMember { id: number; name: string; family_branch: string | null; }

async function convertGregorianToHebrew(m: number, d: number, y: number) {
  // Never reject — a network drop must not strand converting=true (Save disabled).
  try {
    const res = await fetch(`/api/convert?dir=gToH&m=${m}&d=${d}&y=${y}`);
    if (!res.ok) return null;
    return res.json() as Promise<{ hebrew_day: number; hebrew_month: string }>;
  } catch {
    return null;
  }
}


export function AddPersonModal() {
  const { spell, t, branches } = useUserPrefs();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'person' | 'event'>('person');
  const [newPersonId, setNewPersonId] = useState<number | null>(null);
  const [allMembers, setAllMembers] = useState<SimpleMember[]>([]);
  const [converting, setConverting] = useState(false);

  // Person fields — given name(s) and surname are separate.
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [maiden, setMaiden] = useState('');
  const [branch, setBranch] = useState('');
  const [parentIds, setParentIds] = useState<number[]>([]);
  const [spouseId, setSpouseId] = useState<number | ''>('');

  // Event fields (optional birthday)
  const [addBirthday, setAddBirthday] = useState(true);
  const [eventType, setEventType] = useState<EventType>('birthday');
  const [hebrewDay, setHebrewDay] = useState<number | ''>('');
  const [hebrewMonth, setHebrewMonth] = useState('');
  const [gregMonth, setGregMonth] = useState<number | ''>('');
  const [gregDay, setGregDay] = useState<number | ''>('');
  const [gregYear, setGregYear] = useState<number | ''>('');

  useEffect(() => {
    if (open && allMembers.length === 0) {
      getAllFamilyMembers()
        .then(members => setAllMembers(members as SimpleMember[]))
        .catch(() => setError('Could not load the family list. Please close and try again.'));
    }
  }, [open, allMembers.length]);

  function handleClose() {
    setOpen(false); setError(null); setStep('person');
    setName(''); setLastName(''); setNickname(''); setMaiden(''); setBranch(''); setParentIds([]); setSpouseId('');
    setAddBirthday(true); setEventType('birthday'); setConverting(false);
    setHebrewDay(''); setHebrewMonth('');
    setGregMonth(''); setGregDay(''); setGregYear('');
    setNewPersonId(null);
  }

  // Bumped per change so a slow/out-of-order conversion can't overwrite a newer one.
  const convReq = useRef(0);
  async function handleGregorianChange(m: number | '', d: number | '', y: number | '') {
    setGregMonth(m); setGregDay(d); setGregYear(y);
    // Clear any previously-calculated Hebrew date so a stale value can't be saved
    // against the new English date if the user submits mid-recalculation.
    setHebrewDay(''); setHebrewMonth('');
    if (!m || !d || !y || (y as number) < 1800) return;
    const reqId = ++convReq.current;
    setConverting(true);
    const result = await convertGregorianToHebrew(m as number, d as number, y as number);
    if (reqId !== convReq.current) return; // superseded by a newer change — ignore
    setConverting(false);
    if (result) { setHebrewDay(result.hebrew_day); setHebrewMonth(result.hebrew_month); }
  }

  // ISO value for the native date input — only when all three parts are present.
  const gregISO = (gregYear && gregMonth && gregDay)
    ? `${String(gregYear).padStart(4, '0')}-${String(gregMonth).padStart(2, '0')}-${String(gregDay).padStart(2, '0')}`
    : '';

  function handlePersonSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('form.err_name_required')); return; }
    startTransition(async () => {
      const result = await createPersonAction({
        name: name.trim(),
        last_name: lastName.trim() || undefined,
        family_branch: branch,
        parent_ids: parentIds,
        spouse_id: spouseId ? (spouseId as number) : undefined,
        nickname: nickname.trim() || undefined,
        maiden_name: maiden.trim() || undefined,
      });
      if (result.error) { setError(result.error); return; }
      setNewPersonId(result.id!);
      setStep('event');
      setError(null);
    });
  }

  function handleEventSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addBirthday) { handleClose(); return; }
    if (!gregMonth || !gregDay || !gregYear) {
      setError(t('form.err_full_english_or_uncheck'));
      return;
    }
    if (!hebrewDay || !hebrewMonth) {
      setError(converting ? t('form.err_calculating') : t('form.err_hebrew_failed'));
      return;
    }
    const englishDate = `${gregYear}-${String(gregMonth).padStart(2,'0')}-${String(gregDay).padStart(2,'0')}`;
    startTransition(async () => {
      const result = await createEventAction({
        name,
        family_member_id: newPersonId ?? undefined, // link by the just-created id, not by name
        family_branch: branch,
        event_type: eventType,
        hebrew_day: hebrewDay as number,
        hebrew_month: hebrewMonth,
        gregorian_year: gregYear ? (gregYear as number) : undefined,
        original_english_date: englishDate,
        deriveFromEnglish: true, // this modal always enters a fresh English date
      });
      if (result.error) { setError(result.error); return; }
      handleClose();
    });
  }

  const sortedMembers = [...allMembers].sort((a, b) => a.name.localeCompare(b.name));

  function stepBadge(active: boolean, n: number, label: string) {
    return (
      <div className={`flex items-center gap-1.5 text-sm ${active ? 'text-ink' : 'text-ink-faint'}`}>
        <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${active ? 'sig-accent' : 'bg-parchment-dark text-ink-faint'}`}>{n}</span>
        {label}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="sig-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
      >
        {t('person.add')}
      </button>

      {open && (
        <Modal title={t('form.add_person_title')} onClose={handleClose} closeOnBackdrop={false}>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-5">
            {stepBadge(step === 'person', 1, t('form.step_person'))}
            <div className="flex-1 h-px bg-warm-border" />
            {stepBadge(step === 'event', 2, t('form.step_birthday'))}
          </div>

          {/* Step 1: Person details */}
          {step === 'person' && (
            <form onSubmit={handlePersonSubmit} className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-[3]">
                  <label className={fieldLabel}>{t('form.given_names')} *</label>
                  <input
                    type="text" value={name} onChange={e => setName(e.target.value)}
                    required placeholder={t('form.given_placeholder')}
                    className={fieldInput}
                  />
                </div>
                <div className="flex-[2]">
                  <label className={fieldLabel}>{t('form.last_name')}</label>
                  <input
                    type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                    placeholder={t('form.last_placeholder')}
                    className={fieldInput}
                  />
                </div>
              </div>

              <div>
                <label className={fieldLabel}>{t('person.nickname')} <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span></label>
                <input
                  type="text" value={nickname} onChange={e => setNickname(e.target.value)}
                  placeholder={t('person.nickname_placeholder')}
                  className={fieldInput}
                />
              </div>

              <div>
                <label className={fieldLabel}>{t('person.maiden')} <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span></label>
                <input
                  type="text" value={maiden} onChange={e => setMaiden(e.target.value)}
                  placeholder={t('person.maiden_placeholder')}
                  className={fieldInput}
                />
                <p className="text-xs text-ink-faint mt-1">{t('person.maiden_help')}</p>
              </div>

              <div>
                <label className={fieldLabel}>{t('person.branch')}</label>
                <select aria-label={t('person.branch')} value={branch} onChange={e => setBranch(e.target.value)} className={fieldInput}>
                  <option value="">{t('form.select_branch')}</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                <label className={fieldLabel}>{t('form.parents')}</label>
                <p className="text-xs text-ink-faint mb-2">{t('form.parents_help')}</p>
                <div className="border border-warm-border rounded-md max-h-32 overflow-y-auto text-sm">
                  {sortedMembers.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-parchment-dark cursor-pointer">
                      <input
                        type="checkbox"
                        checked={parentIds.includes(m.id)}
                        onChange={e => setParentIds(prev =>
                          e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                        )}
                        className="accent-[#4C4F30]"
                      />
                      <span className="text-ink-2">{cleanName(m.name)}</span>
                      {m.family_branch && <span className="text-ink-faint text-xs">· {spell(m.family_branch)}</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={fieldLabel}>{t('form.spouse')} <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span></label>
                <select aria-label={t('form.spouse')} value={spouseId} onChange={e => setSpouseId(e.target.value ? parseInt(e.target.value) : '')} className={fieldInput}>
                  <option value="">{t('form.none')}</option>
                  {sortedMembers.map(m => (
                    <option key={m.id} value={m.id}>{cleanName(m.name)}</option>
                  ))}
                </select>
              </div>

              {error && <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={isPending} className={`${btnPrimary} flex-1`}>
                  {isPending ? t('person.saving') : t('form.next_birthday')}
                </button>
                <button type="button" onClick={handleClose} className={btnGhost}>{t('person.cancel')}</button>
              </div>
            </form>
          )}

          {/* Step 2: Birthday */}
          {step === 'event' && (
            <form onSubmit={handleEventSubmit} className="space-y-4">
              <p className="text-sm text-accent-ink bg-accent-soft/50 rounded-md px-3 py-2">
                ✓ <strong>{name}</strong> {t('form.person_added_suffix')}
              </p>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="addBday" checked={addBirthday} onChange={e => setAddBirthday(e.target.checked)} className="accent-[#4C4F30]" />
                <label htmlFor="addBday" className="text-sm text-ink-2">{t('form.add_bday_for')} {name.split(' ')[0]}</label>
              </div>

              {addBirthday && (
                <>
                  <div>
                    <label className={fieldLabel}>{t('form.event_type')}</label>
                    <select aria-label={t('form.event_type')} value={eventType} onChange={e => setEventType(e.target.value as EventType)} className={fieldInput}>
                      {/* 'Other' needs a description field this quick add-birthday
                          step doesn't have (the server would reject it); add 'Other'
                          events via the calendar's Add Event instead. */}
                      {EVENT_TYPES.filter(et => et.value !== 'other').map(et => <option key={et.value} value={et.value}>{et.icon} {t(`event.${et.value}`)}</option>)}
                    </select>
                  </div>

                  <div className="rounded-md border border-warm-border bg-parchment p-4 space-y-3">
                    <div className="label">
                      {t('form.english_date')} * {converting && <span className="text-accent-ink normal-case tracking-normal">· {t('form.calculating')}</span>}
                    </div>
                    {/* Native date picker: user's locale order, real-date validation. */}
                    <input
                      type="date"
                      min="1800-01-01" max="2100-12-31"
                      required
                      value={gregISO}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) { handleGregorianChange('', '', ''); return; }
                        const [y, m, d] = v.split('-').map(Number);
                        handleGregorianChange(m, d, y);
                      }}
                      className={`${fieldInput} py-1.5`}
                    />

                    {/* Calculated Hebrew date — read-only, derived from the English date */}
                    <div className="flex items-center justify-between gap-3 rounded-md bg-parchment-card border border-warm-border px-3 py-2.5">
                      <span className="text-[10px] text-ink-muted uppercase tracking-wide">{t('form.hebrew_date')}</span>
                      {hebrewDay && hebrewMonth ? (
                        <span className="text-sm font-medium text-ink">{hebrewDay} {hebrewMonth}</span>
                      ) : (
                        <span className="text-sm text-ink-faint italic">
                          {converting ? t('form.calculating') : t('form.enter_english_above')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted">
                      {t('form.hebrew_help_auto')}
                    </p>
                  </div>
                </>
              )}

              {error && <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={isPending || (addBirthday && converting)} className={`${btnPrimary} flex-1`}>
                  {isPending ? t('person.saving') : converting && addBirthday ? t('form.calculating_btn') : addBirthday ? t('form.save_finish') : t('form.skip_finish')}
                </button>
                {/* The person is already saved after step 1 — Done just closes. */}
                <button type="button" onClick={handleClose} disabled={isPending} className={btnGhost}>{t('form.done')}</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
