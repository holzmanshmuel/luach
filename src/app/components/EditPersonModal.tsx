'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { FamilyBranch } from '@/lib/types';
import {
  updatePersonAction,
  updatePersonPhotoAction,
  updatePersonRelationshipsAction,
  setHebrewNameAction,
  getPersonRelationships,
  getAllFamilyMembers,
  getPersonById,
} from '@/app/actions';
import { useUserPrefs } from './UserPrefsContext';
import { Avatar } from './Avatar';
import { Modal, fieldLabel, fieldInput, btnPrimary, btnGhost } from './Modal';

interface PersonToEdit {
  id: number;
  name: string;
  last_name?: string | null;
  name_he?: string | null;
  nickname: string | null;
  maiden_name?: string | null;
  family_branch: FamilyBranch | null;
  photo_url?: string | null;
}

async function resizePhotoToDataUrl(file: File, maxDim = 400): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // JPEG with moderate quality keeps photos well under the 600KB server cap.
  return canvas.toDataURL('image/jpeg', 0.85);
}

interface SimpleMember {
  id: number;
  name: string;
  nickname: string | null;
  family_branch: string | null;
}

interface Props {
  person: PersonToEdit;
  onClose: () => void;
}

export function EditPersonModal({ person, onClose }: Props) {
  const { t, spell, branches } = useUserPrefs();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Basic info fields
  const rawName = person.name.replace(/~[^~]+$/, '').replace(/\\/g, '');
  const [editName, setEditName] = useState(rawName);
  const [editLastName, setEditLastName] = useState((person.last_name ?? '').replace(/\\/g, ''));
  const [editNameHe, setEditNameHe] = useState(person.name_he ?? '');
  const [editNickname, setEditNickname] = useState(person.nickname ?? '');
  const [editMaiden, setEditMaiden] = useState(person.maiden_name ?? '');
  const [editBranch, setEditBranch] = useState(person.family_branch ?? '');
  // A stored branch this family's current list doesn't have (written before the
  // list changed, or by another deployment) still gets an option of its own —
  // otherwise the <select> would render blank and quietly wipe the value on the
  // next save.
  const branchOptions = !editBranch || branches.includes(editBranch)
    ? branches
    : [...branches, editBranch];

  // Photo state: starts as current URL (may be data-url base64 or null)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(person.photo_url ?? null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Phone + nudge opt-in (fetched after mount since not on FamilyTreeNode)
  const [editPhone, setEditPhone] = useState<string>('');
  const [notifsEnabled, setNotifsEnabled] = useState<boolean>(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('err.photo_type'));
      return;
    }
    setError(null);
    setPhotoProcessing(true);
    try {
      const dataUrl = await resizePhotoToDataUrl(file);
      setPhotoDataUrl(dataUrl);
      setPhotoChanged(true);
    } catch {
      setError(t('err.image_read'));
    } finally {
      setPhotoProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleRemovePhoto() {
    setPhotoDataUrl(null);
    setPhotoChanged(true);
  }

  // Relationship fields
  const [parentIds, setParentIds] = useState<number[]>([]);
  const [spouseIds, setSpouseIds] = useState<number[]>([]);
  const [allMembers, setAllMembers] = useState<SimpleMember[]>([]);
  const [loadingRelations, setLoadingRelations] = useState(true);
  // True only once the relationships loaded SUCCESSFULLY. If the load fails we must
  // NOT write relationships on save — the empty parent/spouse state would DELETE
  // every existing link. Also holds the loaded snapshot so we only write when the
  // user actually changed a relationship (not on a photo/phone-only edit).
  const [relationsLoaded, setRelationsLoaded] = useState(false);
  const loadedParentIds = useRef<number[]>([]);
  const loadedSpouseIds = useRef<number[]>([]);
  // The Hebrew name as loaded from the DB. We only re-"confirm" it on save if the
  // user actually changed it — otherwise opening Edit just to set a phone number
  // would silently mark an unreviewed auto-suggested spelling as human-verified.
  const loadedNameHe = useRef('');

  useEffect(() => {
    Promise.all([
      getAllFamilyMembers() as Promise<SimpleMember[]>,
      getPersonRelationships(person.id),
      getPersonById(person.id),
    ]).then(([members, relations, detail]) => {
      setAllMembers(members.filter(m => m.id !== person.id));
      setParentIds(relations.parentIds);
      setSpouseIds(relations.spouseIds);
      loadedParentIds.current = relations.parentIds;
      loadedSpouseIds.current = relations.spouseIds;
      setRelationsLoaded(true);
      if (detail) {
        setEditPhone(detail.phone_e164 ?? '');
        setNotifsEnabled(detail.notifications_enabled ?? false);
        setEditMaiden(detail.maiden_name ?? '');
        setEditLastName(detail.last_name ?? '');
        // Load the canonical Hebrew name from the DB so saving can't silently
        // wipe it when the caller (e.g. the family tree) didn't pass name_he.
        setEditNameHe(detail.name_he ?? '');
        loadedNameHe.current = detail.name_he ?? '';
      }
      setLoadingRelations(false);
    }).catch(() => {
      setError(t('err.load_person'));
      setLoadingRelations(false);
    });
  }, [person.id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) { setError(t('err.name_required')); return; }
    setError(null);
    startTransition(async () => {
      const calls: Promise<{ error?: string }>[] = [
        updatePersonAction({
          id: person.id,
          name: editName,
          last_name: editLastName,
          family_branch: editBranch,
          nickname: editNickname,
          maiden_name: editMaiden,
          phone_e164: editPhone,
          notifications_enabled: notifsEnabled,
        }),
      ];
      // Only rewrite relationships when they loaded successfully AND the user
      // actually changed them — otherwise a failed/slow load or an unrelated edit
      // (photo, phone) would DELETE every parent/spouse link.
      const sameSet = (a: number[], b: number[]) =>
        a.length === b.length && a.every(id => b.includes(id));
      const relChanged =
        !sameSet(parentIds, loadedParentIds.current) ||
        !sameSet(spouseIds, loadedSpouseIds.current);
      if (relationsLoaded && relChanged) {
        calls.push(updatePersonRelationshipsAction({
          personId: person.id,
          parentIds,
          spouseIds,
        }));
      }
      // Only (re)confirm the Hebrew name when the user actually edited it.
      if (editNameHe.trim() !== loadedNameHe.current.trim()) {
        calls.push(setHebrewNameAction({ id: person.id, name_he: editNameHe }));
      }
      if (photoChanged) {
        calls.push(updatePersonPhotoAction({ id: person.id, photoDataUrl }));
      }
      const results = await Promise.all(calls);
      const err = results.find(r => r.error)?.error;
      if (err) setError(err);
      else onClose();
    });
  }

  const sortedMembers = [...allMembers].sort((a, b) =>
    a.name.replace(/~[^~]+$/, '').replace(/\\/g, '').localeCompare(
      b.name.replace(/~[^~]+$/, '').replace(/\\/g, '')
    )
  );

  function displayMemberName(m: SimpleMember): string {
    return m.name.replace(/~[^~]+$/, '').replace(/\\/g, '');
  }

  return (
    <Modal title={t('tree.edit_person')} onClose={onClose} maxWidth="max-w-sm" closeOnBackdrop={false}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Photo */}
        <div className="flex items-center gap-3">
          <Avatar name={rawName} photoUrl={photoDataUrl} branch={person.family_branch} size="lg" />
          <div className="flex-1 flex flex-col gap-1.5 items-start">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoProcessing}
              className="text-xs rounded-full border border-warm-border bg-parchment px-3 py-1.5 text-ink-muted hover:bg-parchment-dark disabled:opacity-50 transition-colors"
            >
              {photoProcessing ? 'Processing…' : photoDataUrl ? 'Change photo' : 'Add photo'}
            </button>
            {photoDataUrl && (
              <button type="button" onClick={handleRemovePhoto} className="text-[11px] text-ink-faint hover:text-red-700 transition-colors">
                Remove
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Name — given name(s) + surname as separate fields. */}
        <div className="flex gap-3">
          <div className="flex-[3]">
            <label className={fieldLabel}>{t('form.given_names')}</label>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required className={fieldInput} />
          </div>
          <div className="flex-[2]">
            <label className={fieldLabel}>{t('form.last_name')}</label>
            <input type="text" value={editLastName} onChange={e => setEditLastName(e.target.value)} className={fieldInput} />
          </div>
        </div>

        {/* Hebrew name (suggest → confirm) */}
        <div>
          <label className={fieldLabel}>שם בעברית · Hebrew name</label>
          <input
            type="text"
            dir="rtl"
            value={editNameHe}
            onChange={e => setEditNameHe(e.target.value)}
            placeholder="שם בעברית"
            className={fieldInput}
          />
          {person.name_he && (
            <p className="text-[10px] text-ink-faint mt-1">
              Shown in Hebrew mode. Saving confirms the suggested spelling.
            </p>
          )}
        </div>

        {/* Nickname */}
        <div>
          <label className={fieldLabel}>{t('person.nickname')}</label>
          <input
            type="text" value={editNickname} onChange={e => setEditNickname(e.target.value)}
            placeholder={t('person.nickname_placeholder')}
            className={fieldInput}
          />
        </div>

        {/* Maiden name */}
        <div>
          <label className={fieldLabel}>{t('person.maiden')} <span className="text-ink-faint normal-case tracking-normal">{t('person.optional')}</span></label>
          <input
            type="text" value={editMaiden} onChange={e => setEditMaiden(e.target.value)}
            placeholder={t('person.maiden_placeholder')}
            className={fieldInput}
          />
          <p className="text-xs text-ink-faint mt-1">{t('person.maiden_help')}</p>
        </div>

        {/* Branch */}
        <div>
          <label className={fieldLabel}>{t('person.branch')}</label>
          <select aria-label={t('person.branch')} value={editBranch} onChange={e => setEditBranch(e.target.value)} className={fieldInput}>
            <option value="">Select branch…</option>
            {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* WhatsApp nudges */}
        <div className="border-t border-warm-border pt-3">
          <div className="label mb-2.5">WhatsApp nudges</div>
          <div className="space-y-2">
            <div>
              <label className={fieldLabel}>Phone (E.164)</label>
              <input
                type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)}
                placeholder="+14155551234"
                className={fieldInput}
              />
              <p className="text-[10px] text-ink-faint mt-1">
                Include country code. Leave blank to skip WhatsApp nudges for this person.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={notifsEnabled}
                onChange={e => setNotifsEnabled(e.target.checked)}
                className="accent-[#4C4F30]"
              />
              Send WhatsApp nudges to this person
            </label>
          </div>
        </div>

        {/* Relationships */}
        <div className="border-t border-warm-border pt-3">
          <div className="label mb-2.5">Relationships</div>

          {loadingRelations ? (
            <div className="text-xs text-ink-faint py-2">Loading…</div>
          ) : (
            <>
              {/* Parents */}
              <div className="mb-3">
                <label className={fieldLabel}>
                  Parents <span className="text-ink-faint normal-case tracking-normal">(select all that apply)</span>
                </label>
                <div className="border border-warm-border rounded-md max-h-32 overflow-y-auto bg-parchment">
                  {sortedMembers.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-parchment-dark cursor-pointer">
                      <input
                        type="checkbox"
                        checked={parentIds.includes(m.id)}
                        onChange={e =>
                          setParentIds(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                          )
                        }
                        className="accent-[#4C4F30]"
                      />
                      <span className="text-xs text-ink">{displayMemberName(m)}</span>
                      {m.family_branch && <span className="text-[10px] text-ink-faint">· {spell(m.family_branch)}</span>}
                    </label>
                  ))}
                </div>
              </div>

              {/* Spouse(s) — a list so remarriage keeps BOTH partners (checking a
                  second one doesn't erase the first). */}
              <div>
                <label className={fieldLabel}>
                  {t('form.spouse')} <span className="text-ink-faint normal-case tracking-normal">{t('form.spouse_hint')}</span>
                </label>
                <div className="border border-warm-border rounded-md max-h-32 overflow-y-auto bg-parchment">
                  {sortedMembers.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-parchment-dark cursor-pointer">
                      <input
                        type="checkbox"
                        checked={spouseIds.includes(m.id)}
                        onChange={e =>
                          setSpouseIds(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                          )
                        }
                        className="accent-[#4C4F30]"
                      />
                      <span className="text-xs text-ink">{displayMemberName(m)}</span>
                      {m.family_branch && <span className="text-[10px] text-ink-faint">· {spell(m.family_branch)}</span>}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={isPending || loadingRelations} className={`${btnPrimary} flex-1`}>
            {isPending ? t('person.saving') : t('person.save')}
          </button>
          <button type="button" onClick={onClose} className={`${btnGhost} flex-1`}>
            {t('person.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
