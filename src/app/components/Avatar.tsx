'use client';

import { useState } from 'react';
import { FamilyBranch } from '@/lib/types';
import { branchStyle } from '@/lib/branches';
import { useUserPrefs } from './UserPrefsContext';

function initialsFor(name: string): string {
  const cleaned = name.replace(/~[^~]+$/, '').replace(/\\/g, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const sizeMap: Record<string, { wh: string; text: string }> = {
  xs: { wh: 'w-7 h-7',   text: 'text-[10px]' },
  sm: { wh: 'w-9 h-9',   text: 'text-xs' },
  md: { wh: 'w-12 h-12', text: 'text-sm' },
  lg: { wh: 'w-16 h-16', text: 'text-base' },
  xl: { wh: 'w-24 h-24', text: 'text-xl' },
};

export function Avatar({
  name,
  photoUrl,
  branch,
  size = 'sm',
  className = '',
}: {
  name: string;
  photoUrl?: string | null;
  branch?: FamilyBranch | null;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const dims = sizeMap[size];
  // Tint by the branch's POSITION in the configured list — an unset, catch-all
  // or unrecognised branch resolves to the neutral tint rather than erroring.
  const { branches } = useUserPrefs();
  const palette = branchStyle(branches, branch);
  const [imgFailed, setImgFailed] = useState(false);

  if (photoUrl && !imgFailed) {
    return (
      <span
        className={`inline-block ${dims.wh} rounded-full overflow-hidden border-2 border-parchment-card shadow-sm ${className}`}
      >
        {/* Intentionally a plain <img>: sources include base64 data URLs
            which next/image's remote-pattern config won't match. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover"
          loading="lazy"
          // Fall back to initials if the photo is broken/corrupt rather than
          // showing the browser's broken-image glyph.
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${dims.wh} rounded-full border border-warm-border ${palette.bg} ${palette.fg} font-display font-semibold ${dims.text} ${className}`}
      aria-label={name}
    >
      {initialsFor(name)}
    </span>
  );
}
