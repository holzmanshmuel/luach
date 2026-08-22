'use client';

import { useUserPrefs } from './UserPrefsContext';

export function UserPrefsToolbar() {
  const { showNicknames, toggleLanguage, toggleNicknames, t } = useUserPrefs();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleNicknames}
        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
          showNicknames
            ? 'sig-accent font-medium'
            : 'border-warm-border text-ink-muted hover:border-ink-muted bg-parchment-card'
        }`}
        title={showNicknames ? 'Show full names' : 'Show nicknames'}
      >
        {t('prefs.nicknames')}
      </button>
      <button
        onClick={toggleLanguage}
        className="text-xs px-2.5 py-1 rounded-full border border-warm-border text-ink-muted hover:border-ink-muted hover:text-ink bg-parchment-card transition-all font-semibold"
        title="Toggle language / החלף שפה"
      >
        {t('prefs.language')}
      </button>
    </div>
  );
}
