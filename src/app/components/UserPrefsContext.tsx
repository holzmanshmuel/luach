'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getT, type Lang } from '@/lib/translations';

interface UserPrefs {
  language: Lang;
  showNicknames: boolean;
  isAdmin: boolean;
  /** Any signed-in family member may add/edit people & events. */
  canEdit: boolean;
  toggleLanguage: () => void;
  toggleNicknames: () => void;
  t: (key: string) => string;
  /**
   * The configured family branches, IN ORDER — resolved from the server's
   * `FAMILY_BRANCHES` and handed down by the root layout. Order is load-bearing:
   * it decides each branch's colour (see `lib/branches.ts`), and the last entry
   * is the catch-all. Client components read the list from here rather than from
   * the environment, which does not exist in the browser.
   */
  branches: string[];
  /** branch -> all accepted spellings (branch value first). */
  branchVariants: Record<string, string[]>;
  /** The viewer's explicit per-branch choices (absent = show names as entered). */
  chosen: Record<string, string>;
  /** The spelling to show for a branch label (chosen if set, else the branch value). */
  spell: (branch: string | null | undefined) => string;
  /** Set the viewer's preferred spelling for a branch; reloads the site. */
  setSpelling: (branch: string, spelling: string) => void;
}

const UserPrefsContext = createContext<UserPrefs>({
  language: 'en',
  showNicknames: false,
  isAdmin: false,
  canEdit: false,
  toggleLanguage: () => {},
  toggleNicknames: () => {},
  t: (key) => key,
  // Empty, not the demo list: the real value always arrives from the root
  // layout, and inventing branch names here would render a family's picker with
  // sides they don't have.
  branches: [],
  branchVariants: {},
  chosen: {},
  spell: (b) => b ?? '',
  setSpelling: () => {},
});

export function useUserPrefs(): UserPrefs {
  return useContext(UserPrefsContext);
}

export function UserPrefsProvider({
  children,
  language, // authoritative, from the server cookie — drives the whole tree
  isAdmin = false,
  canEdit = false,
  branches,
  spellings = {},
  branchVariants = {},
}: {
  children: React.ReactNode;
  language: Lang;
  isAdmin?: boolean;
  canEdit?: boolean;
  /** Configured branch list, in order — from `familyBranches()` on the server. */
  branches: string[];
  spellings?: Record<string, string>;
  branchVariants?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [showNicknames, setShowNicknames] = useState(false);

  const toggleNicknames = useCallback(() => setShowNicknames(n => !n), []);

  const spell = useCallback(
    (branch: string | null | undefined): string => {
      if (!branch) return branch ?? '';
      const opts = branchVariants[branch] ?? [branch];
      const pick = spellings[branch];
      return pick && opts.includes(pick) ? pick : (opts[0] ?? branch);
    },
    [branchVariants, spellings]
  );

  const setSpelling = useCallback(
    (branch: string, spelling: string) => {
      const next = { ...spellings, [branch]: spelling };
      document.cookie = `name_spellings=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      const run = () => router.refresh();
      const startVT = (document as unknown as {
        startViewTransition?: (cb: () => void) => void;
      }).startViewTransition;
      if (typeof startVT === 'function') startVT.call(document, run);
      else run();
    },
    [spellings, router]
  );

  const toggleLanguage = useCallback(() => {
    const next: Lang = language === 'en' ? 'he' : 'en';
    document.cookie = `lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // Direction of the language being entered: HE eases in from the right, EN from the left.
    document.documentElement.dataset.vt = next === 'he' ? 'to-he' : 'to-en';
    const run = () => router.refresh();
    const startVT = (document as unknown as {
      startViewTransition?: (cb: () => void) => void;
    }).startViewTransition;
    if (typeof startVT === 'function') startVT.call(document, run);
    else run();
  }, [language, router]);

  const t = useCallback((key: string) => getT(language)(key), [language]);

  return (
    <UserPrefsContext.Provider
      value={{ language, showNicknames, isAdmin, canEdit, toggleLanguage, toggleNicknames, t, branches, branchVariants, chosen: spellings, spell, setSpelling }}
    >
      {children}
    </UserPrefsContext.Provider>
  );
}
