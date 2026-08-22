'use client';

import { useState, useTransition } from 'react';
import { BranchSpelling } from '@/lib/types';
import { branchStyle, namedBranches } from '@/lib/branches';
import { Modal, fieldInput } from './Modal';
import { useUserPrefs } from './UserPrefsContext';
import { addBranchSpellingAction, deleteBranchSpellingAction } from '@/app/actions';

interface Option { spelling: string; id: number | null } // id === null → the canonical (not removable)

/**
 * "How we spell our names" — the family argues over the spellings, so every one
 * is equal. Each viewer picks the spelling they prefer for each branch and the
 * whole site re-renders in it (names included). Anyone can add a missing
 * spelling; only added ones (not the canonical branch value) can be removed.
 */
export function BranchSpellingsModal({ spellings }: { spellings: BranchSpelling[] }) {
  const { t, canEdit, isAdmin, chosen, setSpelling, branches } = useUserPrefs();
  // The catch-all (last configured branch) names no surname, so there is
  // nothing to spell — it is deliberately absent from this list.
  const spellable = namedBranches(branches);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function optionsFor(branch: string): Option[] {
    const added = spellings
      .filter(s => s.branch === branch)
      .map(s => ({ spelling: s.spelling, id: s.id }));
    return [{ spelling: branch, id: null }, ...added];
  }

  function add(branch: string) {
    const val = (drafts[branch] ?? '').trim();
    if (!val) return;
    setError(null);
    startTransition(async () => {
      const res = await addBranchSpellingAction(branch, val);
      if (res.error) setError(res.error);
      else {
        setDrafts(d => ({ ...d, [branch]: '' }));
        setSpelling(branch, val); // adopt the spelling you just added
      }
    });
  }

  function remove(branch: string, id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteBranchSpellingAction(id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-warm-border bg-parchment-card px-4 py-2 text-sm font-medium text-ink hover:bg-parchment-dark transition-colors"
      >
        🔤 {t('spellings.button')}
      </button>

      {open && (
        <Modal title={t('spellings.title')} onClose={() => { setOpen(false); setError(null); }}>
          <p className="text-sm text-ink-muted mb-4">{t('spellings.subtitle')}</p>

          <div className="space-y-4">
            {spellable.map(branch => {
              const options = optionsFor(branch);
              // Only what the viewer EXPLICITLY picked — absent means "as entered",
              // so nothing is highlighted until they choose.
              const picked = chosen[branch];
              return (
                <div key={branch} className="rounded-md border border-warm-border bg-parchment p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${branchStyle(branches, branch).dot}`} />
                    <span className="font-medium text-ink">{picked ?? branch}</span>
                    <span className="text-[11px] text-ink-faint">
                      {picked ? t('spellings.your_choice') : t('spellings.as_entered')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {options.map(opt => {
                      const selected = picked === opt.spelling;
                      return (
                        <span
                          key={opt.spelling}
                          className={`inline-flex items-center gap-1 text-xs rounded-full ps-2.5 pe-1.5 py-1 border transition-colors ${
                            selected
                              ? 'border-emerald-400 bg-emerald-50 text-emerald-900 font-medium'
                              : 'border-warm-border bg-parchment-card text-ink-2'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSpelling(branch, opt.spelling)}
                            className="leading-none"
                            aria-pressed={selected}
                          >
                            {opt.spelling}
                          </button>
                          {isAdmin && opt.id !== null && (
                            <button
                              type="button"
                              onClick={() => remove(branch, opt.id!)}
                              disabled={isPending}
                              aria-label={`Remove ${opt.spelling}`}
                              className="text-ink-faint hover:text-red-700 disabled:opacity-50 leading-none text-sm"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {canEdit && (
                    <div className="flex gap-2 mt-2.5">
                      <input
                        type="text"
                        value={drafts[branch] ?? ''}
                        onChange={e => setDrafts(d => ({ ...d, [branch]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(branch); } }}
                        placeholder={t('spellings.add_placeholder')}
                        className={`${fieldInput} text-sm py-1.5`}
                      />
                      <button
                        type="button"
                        onClick={() => add(branch)}
                        disabled={isPending || !(drafts[branch] ?? '').trim()}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50 transition-colors"
                      >
                        {t('spellings.add')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2 mt-3">{error}</p>}
        </Modal>
      )}
    </>
  );
}
