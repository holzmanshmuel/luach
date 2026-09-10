'use client';

import { useState, useEffect, useRef } from 'react';
import { Modal, btnGhost } from './Modal';
import { useUserPrefs } from './UserPrefsContext';

type Platform = 'apple' | 'google' | 'android';

interface Urls { httpsUrl: string; webcalUrl: string; }

const TABS: { key: Platform; label: string; icon: string }[] = [
  { key: 'apple',   label: 'iPhone / Mac', icon: '' },
  { key: 'google',  label: 'Google',       icon: '' },
  { key: 'android', label: 'Android',      icon: '' },
];

export function SubscribeModal({ label }: { label: string }) {
  const { t } = useUserPrefs();
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<Urls | null>(null);
  const [tab, setTab] = useState<Platform>('apple');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || urls) return;
    fetch('/api/subscribe/info')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Urls | null) => d && setUrls(d))
      .catch(() => {});
  }, [open, urls]);

  function handleClose() {
    setOpen(false);
    // Reset the "Copied!" label and cancel its pending timer so reopening the
    // modal doesn't briefly show a stale confirmation.
    setCopied(false);
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }

  async function copy() {
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls.httpsUrl);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label hover:text-ink flex items-center gap-1.5 transition-colors"
        title={label}
      >
        <span>📅</span><span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <Modal title={t('subscribe.title')} onClose={handleClose} maxWidth="max-w-lg">
          <p className="text-sm text-ink-2 -mt-1 mb-4">{t('subscribe.intro')}</p>

          {/* The calendar URL + copy */}
          <div className="rounded-md border border-warm-border bg-parchment p-3 mb-5">
            <div className="label mb-1.5">{t('subscribe.url_label')}</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                // A URL is always left-to-right. Without this it inherits the
                // page's RTL direction in Hebrew and renders right-aligned with
                // the wrong end truncated — so the part a person needs to check
                // is the part they cannot see.
                dir="ltr"
                aria-label={t('subscribe.url_label')}
                value={urls?.httpsUrl ?? '…'}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-parchment-card border border-warm-border rounded px-2.5 py-1.5 text-xs font-mono text-ink-2 outline-none"
              />
              <button
                type="button"
                onClick={copy}
                disabled={!urls}
                className="sig-primary shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {copied ? t('subscribe.copied') : t('subscribe.copy')}
              </button>
            </div>
          </div>

          {/* Platform tabs */}
          <div className="inline-flex rounded-full border border-warm-border bg-parchment-card overflow-hidden text-xs mb-4">
            {TABS.map((tb, i) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                aria-pressed={tab === tb.key}
                className={`px-3.5 py-1.5 transition-colors ${i > 0 ? 'border-s border-warm-border' : ''} ${
                  tab === tb.key ? 'sig-accent font-medium' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t(`subscribe.tab_${tb.key}`)}
              </button>
            ))}
          </div>

          {/* Instructions */}
          <div className="text-sm text-ink-2 space-y-3 min-h-[7rem]">
            {tab === 'apple' && (
              <>
                <p className="text-ink-muted">{t('subscribe.apple_lead')}</p>
                {urls ? (
                  <a
                    href={urls.webcalUrl}
                    className="sig-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  >
                    📅 {t('subscribe.apple_button')}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="sig-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium opacity-50 cursor-not-allowed"
                  >
                    📅 {t('subscribe.apple_button')}
                  </button>
                )}
                <p className="text-xs text-ink-faint">{t('subscribe.apple_manual')}</p>
              </>
            )}

            {tab === 'google' && (
              <ol className="list-decimal ms-5 space-y-1.5 marker:text-ink-faint">
                <li>{t('subscribe.google_1')}</li>
                <li>{t('subscribe.google_2')}</li>
                <li>{t('subscribe.google_3')}</li>
                <li>{t('subscribe.google_4')}</li>
              </ol>
            )}

            {tab === 'android' && (
              <>
                <p>{t('subscribe.android_lead')}</p>
                <ol className="list-decimal ms-5 space-y-1.5 marker:text-ink-faint">
                  <li>{t('subscribe.android_1')}</li>
                  <li>{t('subscribe.android_2')}</li>
                </ol>
                <p className="text-xs text-ink-faint">{t('subscribe.android_note')}</p>
              </>
            )}
          </div>

          <div className="flex justify-end pt-5">
            <button type="button" onClick={handleClose} className={btnGhost}>
              {t('subscribe.done')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
