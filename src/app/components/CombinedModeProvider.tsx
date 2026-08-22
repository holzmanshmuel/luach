'use client';

import { createContext, useContext } from 'react';
import type { FamilyTag } from '@/lib/types';

interface CombinedMode { combined: boolean; viewFamilies: FamilyTag[] }

// Default is single-family / non-combined, so any page that does NOT wrap its
// tree in <CombinedModeProvider> (e.g. the family tree, out of scope for this
// task) reads as plain single-family — never crashes, never fakes combined mode.
const Ctx = createContext<CombinedMode>({ combined: false, viewFamilies: [] });

export function useCombinedMode(): CombinedMode {
  return useContext(Ctx);
}

export function CombinedModeProvider({
  combined,
  viewFamilies,
  children,
}: CombinedMode & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ combined, viewFamilies }}>{children}</Ctx.Provider>;
}
