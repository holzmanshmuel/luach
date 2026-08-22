'use client';

import { useState, useEffect } from 'react';
import { useUserPrefs } from './UserPrefsContext';

const STORAGE_KEY = 'fc_welcomed';

/**
 * A one-time welcome shown on the first visit (e.g. when a relative arrives cold
 * via a magic link onto a dense calendar). Dismissal is remembered in
 * localStorage so it never shows again on that device.
 */
export function WelcomeBanner() {
  const { t } = useUserPrefs();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Deferred out of the effect body so we don't synchronously setState during
    // the effect (localStorage isn't available during SSR / initial render).
    const id = requestAnimationFrame(() => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
      } catch {
        /* private mode / storage disabled — just skip the banner */
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  return (
    <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-4 flex items-start gap-3">
      <span className="text-xl leading-none" aria-hidden>👋</span>
      <div className="flex-1">
        <p className="font-display text-lg text-ink mb-0.5">{t('welcome.title')}</p>
        <p className="text-sm text-ink-2">{t('welcome.body')}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-xs rounded-full border border-warm-border bg-parchment-card px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-parchment-dark transition-colors"
      >
        {t('welcome.dismiss')}
      </button>
    </div>
  );
}
