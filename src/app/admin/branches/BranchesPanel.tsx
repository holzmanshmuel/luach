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
import { fieldInput, fieldLabel, btnPrimary, btnGhost } from '@/lib/ui';

/**
 * Owner-facing editor for THIS family's branch list.
 *
 * The whole ordered list is the unit of edit — see actions.ts. Everything the
 * owner does here (add, rename, remove, pick the catch-all) is a change to the
 * draft order; Save writes it. Nothing is written until Save, and the swatches
 * update live so a reorder's cost is visible BEFORE it is committed rather than
 * explained afterwards.
 *
 * Hardcoded English, like the sibling /admin/access and /admin/names panels.
 * The "what would saving cost" reasoning is pure and lives in lib/branch-draft.ts.
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
  const [draft, setDraft] = useState<string[]>(branches);
  const [added, setAdded] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    if (!name) return setError('Type a name for the new branch first.');
    if (name.length > MAX_BRANCH_NAME_LENGTH) {
      return setError(`Keep branch names under ${MAX_BRANCH_NAME_LENGTH} characters.`);
    }
    if (draft.some(b => b.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return setError(`You already have a branch called "${name}".`);
    }
    if (draft.length >= MAX_BRANCHES) {
      return setError(`${MAX_BRANCHES} branches is the limit.`);
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
          <strong className="text-ink">These are the starter branches</strong>, not yours yet — they
          come from this Luach installation&apos;s own setting. Save once and the list becomes your
          family&apos;s, kept separately from every other family here.
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
                title={isCatchAll ? 'No colour — this is the catch-all' : `Colour ${i + 1}`}
                className={`w-6 h-6 shrink-0 rounded-full ${style.bg} border border-warm-border`}
              />
              <input
                value={name}
                onChange={e => rename(i, e.target.value)}
                maxLength={MAX_BRANCH_NAME_LENGTH}
                aria-label={`Branch ${i + 1} name`}
                className={`${fieldInput} flex-1`}
                placeholder="Branch name"
              />
              <span
                className="w-20 shrink-0 text-[10px] text-ink-faint text-end"
                title="People currently filed under this exact word"
              >
                {filed > 0 ? `${filed} ${filed === 1 ? 'person' : 'people'}` : null}
              </span>
              <label className="shrink-0 flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer">
                <input
                  type="radio"
                  name="catch-all"
                  checked={isCatchAll}
                  onChange={() => makeCatchAll(i)}
                  className="accent-accent"
                />
                catch-all
              </label>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={draft.length <= 2}
                title={draft.length <= 2 ? 'Keep at least two branches' : `Remove "${name}"`}
                aria-label={`Remove branch ${name}`}
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
          <label htmlFor="new-branch" className={fieldLabel}>Add a branch</label>
          <input
            id="new-branch"
            value={added}
            onChange={e => { setAdded(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            maxLength={MAX_BRANCH_NAME_LENGTH}
            className={fieldInput}
            placeholder="A surname, e.g. a side that married in"
          />
        </div>
        <button type="button" onClick={add} className={btnGhost}>Add</button>
      </div>
      <p className="text-xs text-ink-faint mt-2">
        New branches go in just above the catch-all, which keeps every existing branch&apos;s colour
        exactly where it is. This is the safe edit.
      </p>

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
              {w.text}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-5 text-sm text-[#8C2F26]">{error}</p>}

      <div className="flex items-center gap-3 mt-6">
        <button type="button" onClick={save} disabled={isPending || !dirty} className={btnPrimary}>
          {isPending ? 'Saving…' : 'Save branches'}
        </button>
        {dirty && (
          <button type="button" onClick={() => { setDraft(branches); setError(null); }} className={btnGhost}>
            Discard changes
          </button>
        )}
        {saved && !dirty && <span className="text-sm text-ink-muted">Saved.</span>}
      </div>

      {/* ── The rules, in plain language ─────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-warm-border space-y-4 text-sm text-ink-2">
        <h2 className="font-display text-lg text-ink">Three things worth knowing</h2>

        <p>
          <strong className="text-ink">The last branch is the &ldquo;no particular branch&rdquo; bucket.</strong>{' '}
          Whichever branch sits at the bottom of the list
          {catchAll ? <> — right now that is <em>{catchAll}</em> —</> : null}{' '}
          is where people go when they don&apos;t belong to any one side, or when the spreadsheet
          importer can&apos;t tell. It is drawn in plain grey rather than a colour, and it is left
          out of the surname-spelling picker, because it isn&apos;t really a surname. Call it
          &ldquo;Other&rdquo;, &ldquo;Misc&rdquo;, &ldquo;אחר&rdquo; — the name doesn&apos;t matter,
          only that it is last.
        </p>

        <p>
          <strong className="text-ink">Adding to the bottom is safe. Shuffling the order is not.</strong>{' '}
          Each branch&apos;s colour comes from its <em>place</em> in this list — first place gets the
          first colour, second place the second, and so on. So adding a new branch changes nothing
          for anyone. But moving a branch up or down, or making a different branch the catch-all,
          hands each affected branch a colour someone else was wearing. Your family has learned
          those colours; they will all quietly change at once. Do it if you mean to, not by accident.
        </p>

        <p>
          <strong className="text-ink">Renaming keeps the colour, but doesn&apos;t re-file anybody.</strong>{' '}
          Fix a spelling here and that branch keeps the exact colour it has — the name changed,
          not the place. What it does <em>not</em> do is update the people already filed under the
          old name: each person stores their branch as plain text, so they stay attached to the old
          word and will show in plain grey until someone edits them. Same story if you remove a
          branch. For a handful of people that is a minute in the tree; for a whole side of the
          family, rename rather than replace.
        </p>
      </div>
    </div>
  );
}
