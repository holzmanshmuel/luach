import { cookies } from 'next/headers';
// Import from the server-safe module directly — NOT through Modal ('use client'),
// where the string would cross the client boundary and drop its classes at render.
import { btnPrimary } from '@/lib/ui';
import { getT, type Lang } from '@/lib/translations';
import { sanitizeNext } from '@/lib/sanitize-next';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const params = await searchParams;
  const invalidLink = params.error === 'invalid_link';
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const oauthError = params.error === 'oauth';
  const rateLimited = params.error === 'rate';

  // Carry a sanitized post-login destination through to the OAuth entry route.
  const safeNext = sanitizeNext(params.from);
  const googleHref = safeNext
    ? `/api/auth/google?next=${encodeURIComponent(safeNext)}`
    : '/api/auth/google';

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="sig-star text-5xl mb-4">✡</div>
          <h1 className="font-display text-3xl text-ink">Family Calendar</h1>
          <p className="text-ink-muted mt-2 text-sm">
            {t('login.intro')}
          </p>
        </div>

        {invalidLink && (
          <div className="mb-4 rounded-md bg-accent-soft/50 border border-warm-border px-3 py-2 text-xs text-ink-2">
            {t('login.link_expired')}
          </div>
        )}

        {oauthError && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {t('login.link_expired')}
          </div>
        )}

        {rateLimited && (
          <div className="mb-4 rounded-md bg-accent-soft/50 border border-warm-border px-3 py-2 text-xs text-ink-2">
            {t('login.rate_limited')}
          </div>
        )}

        {/* Primary (and only) path: Google sign-in. A plain link triggers the GET
            entry route, which mints the CSRF state and redirects to Google. */}
        <a href={googleHref} className={`${btnPrimary} w-full mb-6`}>
          {t('login.google')}
        </a>
      </div>
    </div>
  );
}
