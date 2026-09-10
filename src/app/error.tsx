'use client';

import { useEffect } from 'react';
import { btnPrimary, btnGhost } from '@/lib/ui';

/**
 * What a relative sees when something goes wrong.
 *
 * Without this file Next renders its own bare "This page couldn't load / A server
 * error occurred", with no header, no sign-out, and no route back into the app.
 * That is a dead end for the audience this is built for: someone's grandmother,
 * on a phone, who was sent a link on WhatsApp.
 *
 * Two failures in particular land here and both have a way out that the default
 * page cannot offer:
 *  - a session pointing at a family the person is no longer a member of, which
 *    every page render rejects until they sign out and back in;
 *  - a Server Action failing after a deploy, where a reload picks up the new
 *    build and simply works.
 *
 * Deliberately bilingual and self-contained: no header, no tenant data, nothing
 * that could itself throw. `error.tsx` must render even when the thing it is
 * reporting has broken everything around it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle that ties what the person saw to a line in
    // the server log, so make sure it reaches the browser console too.
    console.error('[luach] render error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="sig-star text-4xl mb-4" aria-hidden>
          ✡
        </div>

        <h1 className="font-display text-2xl text-ink">Something went wrong</h1>
        <p className="text-ink-muted text-sm mt-2">
          This is usually temporary — try again, and if it keeps happening, sign out and back
          in.
        </p>

        <p className="text-ink-muted text-sm mt-4" dir="rtl" lang="he">
          משהו השתבש. בדרך כלל זה זמני — נסו שוב, ואם זה חוזר, התנתקו והתחברו מחדש.
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <button type="button" onClick={reset} className={btnPrimary}>
            Try again · נסו שוב
          </button>
          {/* Plain <a>, NOT <Link>: Next prefetches Link hrefs, and prefetching
              this destructive GET would sign the person out just for landing here. */}
          <a href="/api/logout" className={btnGhost}>
            Sign out · התנתקות
          </a>
        </div>

        {error.digest && (
          <p className="label mt-8 text-ink-faint">Reference {error.digest}</p>
        )}
      </div>
    </div>
  );
}
