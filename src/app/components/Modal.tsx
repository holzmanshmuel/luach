'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

// Shared field/button style strings live in the server-safe '@/lib/ui' module
// (single source of truth). Re-exported here so client components can keep
// importing them from Modal, while Server Components import from '@/lib/ui'
// directly — a string constant re-exported *through* this 'use client' module
// crosses the client boundary and loses its value in a Server Component.
export { fieldLabel, fieldInput, btnPrimary, btnGhost } from '@/lib/ui';

/**
 * Accessible modal dialog: scrim + centered panel on the brand palette, with
 * role="dialog"/aria-modal, focus trap, initial focus, Escape-to-close, focus
 * return to the trigger, and background scroll lock.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-md',
  closeOnBackdrop = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  /**
   * Whether tapping the backdrop closes the modal. Form modals set this false so
   * an accidental tap on the gutter (easy on a phone) can't silently discard a
   * half-filled form — Cancel / × / Escape still close it.
   */
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep the latest onClose in a ref so the focus-trap effect can run ONCE on
  // mount without listing onClose in its deps. Consumers pass a fresh onClose
  // (inline arrow / new handleClose) every render; if the effect depended on it,
  // it would re-run on every keystroke and yank focus back to the first field.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first field (or the first focusable, e.g. the close button).
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    (firstField ?? focusables()[0])?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-parchment-card border border-warm-border rounded-lg w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 sticky top-0 bg-parchment-card z-10">
          <h2 id={titleId} className="font-display text-2xl text-ink leading-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 shrink-0 rounded-full border border-warm-border text-ink-muted hover:text-ink hover:bg-parchment-dark transition-colors flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
