'use client';

import { useState } from 'react';
import { FamilyTreeNode, FamilyMember, BranchSpelling } from '@/lib/types';
import { OrgChart } from './OrgChart';
import { BranchHighlightContext } from './FamilyTreeContext';
import { AddPersonModal } from './AddPersonModal';
import { BranchSpellingsModal } from './BranchSpellingsModal';
import { UserPrefsToolbar } from './UserPrefsToolbar';
import { EditPersonModal } from './EditPersonModal';
import { useUserPrefs } from './UserPrefsContext';
import { displayName } from '@/lib/names';
import { branchStyle, isCatchAllBranch } from '@/lib/branches';
import { backArrow, dirForLang } from '@/lib/direction';
import Link from 'next/link';

// ── Editable card for unlinked members ──────────────────────────────────────

function UnlinkedMemberCard({ member }: { member: FamilyMember }) {
  const [showEdit, setShowEdit] = useState(false);
  const { showNicknames, language, canEdit, spell } = useUserPrefs();

  const name = displayName(member, language, showNicknames);

  return (
    <>
      <button
        onClick={() => { if (canEdit) setShowEdit(true); }}
        className="rounded-lg border border-warm-border bg-parchment-card px-3 py-2 text-xs text-ink-muted hover:border-ink-muted hover:text-ink transition-all cursor-pointer"
      >
        {name}
        {member.family_branch && (
          <span className="text-ink-faint ml-1">· {spell(member.family_branch)}</span>
        )}
      </button>

      {showEdit && (
        <EditPersonModal
          person={member}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

// ── Main client wrapper ──────────────────────────────────────────────────────

export function FamilyTreeClient({
  roots,
  unlinked,
  spellings,
}: {
  roots: FamilyTreeNode[];
  unlinked: FamilyMember[];
  spellings: BranchSpelling[];
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const { t, canEdit, spell, branches, language } = useUserPrefs();

  function toggleBranch(branch: string) {
    setHighlight(h => (h === branch ? null : branch));
  }

  return (
    <BranchHighlightContext.Provider value={highlight}>
      {/* Header */}
      <header className="bg-parchment-card border-b border-warm-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-y-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">
            {/* Direction-chosen, not baked into the label — see lib/direction.ts. */}
            <span aria-hidden>{backArrow(dirForLang(language))}</span> {t('nav.calendar')}
          </Link>
          <span className="text-warm-border">|</span>
          <div className="flex items-center gap-2">
            <span className="text-xl">🌳</span>
            <h1 className="font-display text-xl sm:text-2xl font-medium text-ink tracking-wide">{t('tree.title')}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UserPrefsToolbar />
          <BranchSpellingsModal spellings={spellings} />
          {canEdit && (
            <>
              <div className="w-px h-4 bg-warm-border" />
              <AddPersonModal />
            </>
          )}
        </div>
      </header>

      {/* Legend — clickable branch filters */}
      <div className="max-w-7xl mx-auto px-6 pt-4 pb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-faint mr-1">{t('tree.filter')}</span>
        {branches.map(branch => {
          const { dot } = branchStyle(branches, branch);
          // The catch-all has no surname, so no alternate spellings to apply —
          // it shows exactly as configured.
          const display = isCatchAllBranch(branches, branch) ? branch : spell(branch);
          const isActive = highlight === branch;
          const isDimmed = highlight !== null && !isActive;
          return (
            <button
              key={branch}
              onClick={() => toggleBranch(branch)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all
                ${isActive
                  ? 'sig-accent font-medium'
                  : isDimmed
                  ? 'border-warm-border text-ink-faint opacity-50 hover:opacity-75'
                  : 'border-warm-border text-ink-muted hover:border-ink-muted hover:text-ink bg-parchment-card'
                }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
              {display}
            </button>
          );
        })}
        {highlight && (
          <button
            onClick={() => setHighlight(null)}
            className="text-xs text-accent-ink hover:text-ink ml-1 transition-colors"
          >
            {t('tree.clear_filter')}
          </button>
        )}
        <span className="text-xs text-ink-faint ml-auto">{t('tree.click_hint')}</span>
      </div>

      {/* Org chart */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {roots.length === 0 ? (
          <div className="rounded-lg border border-warm-border bg-parchment-card text-center text-ink-faint py-12">
            No family connections yet. {canEdit
              ? 'Use “+ Add Person” to link parents and spouses, and the chart will appear here.'
              : 'Once relationships are added, the family chart will appear here.'}
          </div>
        ) : (
          <OrgChart roots={roots} />
        )}
      </div>

      {/* Unlinked members */}
      {unlinked.length > 0 && (
        <div className="max-w-7xl mx-auto px-6 pb-10">
          <h2 className="font-display text-sm font-semibold text-ink-muted uppercase tracking-widest mb-3">
            {t('tree.other_members')}
            <span className="font-normal normal-case text-ink-faint ml-2">{t('tree.other_members_sub')}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {unlinked.map(member => (
              <UnlinkedMemberCard key={member.id} member={member} />
            ))}
          </div>
        </div>
      )}
    </BranchHighlightContext.Provider>
  );
}
