'use client';

import { useState, useEffect } from 'react';
import { useUserPrefs } from './UserPrefsContext';

const STORAGE_KEY = 'installPromptDismissed';

// Minimal shape of the (non-standard) BeforeInstallPromptEvent — not yet in
// lib.dom.d.ts, so we declare just what we use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Variant = 'android' | 'ios' | null;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia?.('(display-mode: standalone)').matches || navStandalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // Exclude other iOS browsers, which also include "Safari" in their UA.
  const isOtherBrowser = /crios|fxios|edgios|opios/i.test(ua);
  return isIos && !isOtherBrowser;
}

function wasDismissed(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * Dismissible "Add to Home Screen" nudge.
 * - Android/desktop Chrome: captures `beforeinstallprompt`, shows Install /
 *   Not now, and triggers the native install prompt on Install.
 * - iOS Safari: no such event exists, so we show a one-time textual hint
 *   ("Tap Share → Add to Home Screen") instead.
 * Never shown when already installed, in dev, or after the user dismisses it.
 */
export function InstallPrompt() {
  const { t } = useUserPrefs();
  const [variant, setVariant] = useState<Variant>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined') return;
    if (isStandalone() || wasDismissed()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVariant('android');
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    // No beforeinstallprompt on iOS Safari — show the manual hint instead.
    // Deferred out of the effect body so we don't setState synchronously
    // during the effect (matches the WelcomeBanner pattern).
    const id = requestAnimationFrame(() => {
      if (isIosSafari()) setVariant('ios');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      cancelAnimationFrame(id);
    };
  }, []);

  if (!variant) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* private mode / storage disabled — just hide for this render */
    }
    setVariant(null);
    setDeferredPrompt(null);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    dismiss();
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-lg border border-warm-border bg-parchment-card px-4 py-3.5 shadow-lg flex items-start gap-3 sm:inset-x-auto sm:end-4">
      <span className="text-xl leading-none" aria-hidden>📲</span>
      <div className="flex-1">
        <p className="font-display text-sm text-ink mb-0.5">{t('install.title')}</p>
        <p className="text-xs text-ink-2">
          {variant === 'ios' ? t('install.ios_hint') : t('install.body')}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          {variant === 'android' && (
            <button
              type="button"
              onClick={handleInstall}
              className="sig-primary rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
            >
              {t('install.install')}
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full border border-warm-border bg-parchment-card px-3.5 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-parchment-dark transition-colors"
          >
            {t('install.not_now')}
          </button>
        </div>
      </div>
    </div>
  );
}
