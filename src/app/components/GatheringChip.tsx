'use client';

import { useState } from 'react';
import { Gathering, gatheringIcon } from '@/lib/types';
import { GatheringModal } from './GatheringModal';
import { useUserPrefs } from './UserPrefsContext';

/** Format 'HH:MM' (24h) to a short local-ish label, e.g. "7:30 PM". */
function fmtTime(t: string | null, lang: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * A gathering pill on a calendar day. Distinct green tint (🎉) so it reads clearly
 * apart from the recurring birthday/anniversary/yahrzeit chips. Tapping opens the
 * edit/detail modal (every magic-link family member can edit).
 */
export function GatheringChip({ gathering }: { gathering: Gathering }) {
  const { language } = useUserPrefs();
  const [open, setOpen] = useState(false);
  const time = fmtTime(gathering.gather_time, language);
  // Surfaces which family this gathering belongs to (combined view only) since
  // the tiny grid chip has no room for a label — the stripe + hover tooltip do.
  const familyName = gathering.family
    ? (language === 'he' && gathering.family.nameHe ? gathering.family.nameHe : gathering.family.name)
    : null;
  const title = familyName ? `${gathering.title} · ${familyName}` : gathering.title;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-start flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md text-ink-2 border transition-[filter] hover:brightness-95 leading-5"
        style={{
          backgroundColor: '#DCFCE7',
          borderColor: '#A7F3D0',
          ...(gathering.family && {
            borderInlineStartWidth: '4px',
            borderInlineStartColor: gathering.family.color,
          }),
        }}
        title={title}
        {...(gathering.family && { 'aria-label': title })}
      >
        <span className="shrink-0" aria-hidden>{gatheringIcon(gathering.kind)}</span>
        <span className="truncate">{gathering.title}</span>
        {time && <span className="shrink-0 ms-auto text-[9px] text-emerald-700">{time}</span>}
      </button>
      {open && (
        <GatheringModal
          mode="edit"
          gathering={gathering}
          controlled
          open
          onClose={() => setOpen(false)}
          readOnly={!!gathering.family}
          family={gathering.family}
        />
      )}
    </>
  );
}
