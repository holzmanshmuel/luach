'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveBranchesAction } from './actions';
import {
  branchStyle,
  catchAllBranch,
  MAX_BRANCHES,
  MAX_BRANCH_NAME_LENGTH,
} from '@/lib/branches';
import { computeBranchWarnings } from '@/lib/branch-draft';
import { fillTemplate, type TMessage } from '@/lib/translations';
import { fieldInput, fieldLabel, btnPrimary, btnGhost } from '@/lib/ui';
import { useUserPrefs } from '@/app/components/UserPrefsContext';
import { InterpolatedMany, Message } from '@/app/components/Interpolated';

/**
 * Owner-facing editor for THIS family's branch list.
 *
 * The whole ordered list is the unit of edit — see actions.ts. Everything the
 * owner does here (add, rename, remove, pick the catch-all) is a change to the
 * draft order; Save writes it. Nothing is written until Save, and the swatches
 * update live so a reorder's cost is visible BEFORE it is committed rather than
 * explained afterwards.
 *
 * Bilingual: copy comes from `useUserPrefs().t`. Branch names are the family's own
 * DATA — never translated, `<bdi>`-isolated in sentences, and typed into
 * `dir="auto"` inputs so a Latin surname stays left-aligned on the Hebrew page.
 * Attributes (`title`, `aria-label`) cannot hold a `<bdi>`, so they use the plain
 * `fillTemplate`. The "what would saving cost" reasoning is pure and lives in
 * lib/branch-draft.ts.
 */

export function BranchesPanel({
  branches,
  counts,
  inherited,
}: {
  /** The family's resolved list, in order, as saved. */
  branches: string[];
  /** branch value -> how many people are currently filed under it. */
  counts: Record<string, number>;
  /** True when the family has no list of its own yet and is showing the deployment default. */
  inherited: boolean;
}) {
  const { t } = useUserPrefs();
  const [draft, setDraft] = useState<string[]>(branches);
  const [added, setAdded] = useState('');
  const [error, setError] = useState<TMessage | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, start] = useTransition();

  const dirty = draft.length !== branches.length || draft.some((b, i) => b !== branches[i]);

  function update(next: string[]) {
    setDraft(next);
    setError(null);
    setSaved(false);
  }

  function rename(i: number, value: string) {
    update(draft.map((b, j) => (j === i ? value : b)));
  }

  /** Append. The safe edit: every existing position — and so every colour — stays put. */
  function add() {
    const name = added.trim().replace(/\s+/g, ' ');
    if (!name) return setError({ key: 'branches.err.add_empty' });
    if (name.length > MAX_BRANCH_NAME_LENGTH) {
      return setError({ key: 'branches.err.too_long_short', params: { max: MAX_BRANCH_NAME_LENGTH } });
    }
    if (draft.some(b => b.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return setError({ key: 'branches.err.exists', params: { name } });
    }
    if (draft.length >= MAX_BRANCHES) {
      return setError({ key: 'branches.err.limit', params: { max: MAX_BRANCHES } });
    }
    // Inserted BEFORE the catch-all, so the catch-all stays last (its position is
    // what makes it the catch-all) and every other position is untouched.
    const next = [...draft];
    next.splice(Math.max(next.length - 1, 0), 0, name);
    setAdded('');
    update(next);
  }

  function remove(i: number) {
    update(draft.filter((_, j) => j !== i));
  }

  /** Move entry i to the end — i.e. make it the catch-all. A REORDER: see the warnings. */
  function makeCatchAll(i: number) {
    if (i === draft.length - 1) return;
    const next = [...draft];
    const [moved] = next.splice(i, 1);
    next.push(moved);
    update(next);
  }

  const warnings = useMemo(() => computeBranchWarnings(branches, draft, counts), [branches, draft, counts]);

  function save() {
    start(async () => {
      const res = await saveBranchesAction(draft);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setSaved(true);
      // The saved list is authoritative — the server sanitized it.
      if (res.branches) setDraft(res.branches);
    });
  }

  const catchAll = catchAllBranch(draft);

  return (
    <div>
      {inherited && (
        <p className="text-sm text-ink-2 bg-accent-soft border border-warm-border rounded-lg px-4 py-3 mb-6">
          <strong className="text-ink">{t('branches.inherited_lead')}</strong>{' '}
          {t('branches.inherited_body')}
        </p>
      )}

      {/* ── The list ────────────────────────────────────────────────────────── */}
      <div className="border-y border-warm-border divide-y divide-warm-border/60">
        {draft.map((name, i) => {
          const style = branchStyle(draft, name);
          const isCatchAll = i === draft.length - 1;
          const filed = counts[name.trim()] ?? 0;
          return (
            <div key={i} className="flex items-center gap-3 py-3">
              <span
                aria-hidden
                title={isCatchAll ? t('branches.swatch_catch_all') : fillTemplate(t('branches.swatch_colour'), { n: i + 1 })}
                className={`w-6 h-6 shrink-0 rounded-full ${style.bg} border border-warm-border`}
              />
              <input
                dir="auto"
                value={name}
                onChange={e => rename(i, e.target.value)}
                maxLength={MAX_BRANCH_NAME_LENGTH}
                aria-label={fillTemplate(t('branches.name_aria'), { n: i + 1 })}
                className={`${fieldInput} flex-1`}
                placeholder={t('branches.name_placeholder')}
              />
              <span
                className="w-20 shrink-0 text-[10px] text-ink-faint text-end"
                title={t('branches.filed_title')}
              >
                {filed > 0
                  ? filed === 1
                    ? t('branches.filed_one')
                    : fillTemplate(t('branches.filed_many'), { n: filed })
                  : null}
              </span>
              <label className="shrink-0 flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer">
                <input
                  type="radio"
                  name="catch-all"
                  checked={isCatchAll}
                  onChange={() => makeCatchAll(i)}
                  className="accent-accent"
                />
                {t('branches.catch_all')}
              </label>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={draft.length <= 2}
                title={draft.length <= 2 ? t('branches.keep_two') : fillTemplate(t('branches.remove_title'), { name })}
                aria-label={fillTemplate(t('branches.remove_aria'), { name })}
                className="shrink-0 text-xs rounded-full border border-warm-border px-2.5 py-1 text-ink-muted hover:bg-parchment-dark disabled:opacity-30 transition-colors"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Add ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-3 mt-5">
        <div className="flex-1">
          <label htmlFor="new-branch" className={fieldLabel}>{t('branches.add_label')}</label>
          <input
            id="new-branch"
            dir="auto"
            value={added}
            onChange={e => { setAdded(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            maxLength={MAX_BRANCH_NAME_LENGTH}
            className={fieldInput}
            placeholder={t('branches.add_placeholder')}
          />
        </div>
        <button type="button" onClick={add} className={btnGhost}>{t('branches.add')}</button>
      </div>
      <p className="text-xs text-ink-faint mt-2">{t('branches.add_note')}</p>

      {/* ── Warnings about THIS draft ────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <ul className="mt-6 space-y-2">
          {warnings.map((w, i) => (
            <li
              key={i}
              className={`text-sm rounded-lg px-4 py-3 border ${
                w.tone === 'caution'
                  ? 'bg-[#FDF6E7] border-[#E0CFA0] text-[#6B5A2E]'
                  : 'bg-parchment-dark border-warm-border text-ink-2'
              }`}
            >
              <Message t={t} message={w.message} />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-5 text-sm text-[#8C2F26]">
          <Message t={t} message={error} />
        </p>
      )}

      <div className="flex items-center gap-3 mt-6">
        <button type="button" onClick={save} disabled={isPending || !dirty} className={btnPrimary}>
          {isPending ? t('branches.saving') : t('branches.save')}
        </button>
        {dirty && (
          <button type="button" onClick={() => { setDraft(branches); setError(null); }} className={btnGhost}>
            {t('branches.discard')}
          </button>
        )}
        {saved && !dirty && <span className="text-sm text-ink-muted">{t('branches.saved')}</span>}
      </div>

      {/* ── The rules, in plain language ─────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-warm-border space-y-4 text-sm text-ink-2">
        <h2 className="font-display text-lg text-ink">{t('branches.rules_heading')}</h2>

        <p>
          <strong className="text-ink">{t('branches.rule1_lead')}</strong>{' '}
          {catchAll ? (
            <InterpolatedMany
              template={t('branches.rule1_body_named')}
              params={{ name: catchAll }}
              valueClassName="italic"
            />
          ) : (
            t('branches.rule1_body')
          )}
        </p>

        <p>
          <strong className="text-ink">{t('branches.rule2_lead')}</strong>{' '}
          {t('branches.rule2_body')}
        </p>

        <p>
          <strong className="text-ink">{t('branches.rule3_lead')}</strong>{' '}
          {t('branches.rule3_body')}
        </p>
      </div>
    </div>
  );
}
