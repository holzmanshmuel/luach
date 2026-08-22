'use client';

import { createContext, useContext } from 'react';

export const BranchHighlightContext = createContext<string | null>(null);
export const useBranchHighlight = () => useContext(BranchHighlightContext);
