import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
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
  // A SIGNED-IN visitor has nothing to do here, and this page is where several
  // recovery paths used to dump them — telling an existing member to sign in again
  // is a dead end. Send them where they actually belong. Read via the systemQuery-
  // backed helper: a user with no family has no tenant to scope a query() by.
  const session = await getSession();
  if (session.userId) {
    const memberships = await getMembershipsForUser(session.userId);
    redirect(memberships.length > 0 ? '/' : '/onboarding');
  }

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
          {/* Translated: this was a literal English <h1> sitting inside an RTL page. */}
          <h1 className="font-display text-3xl text-ink">{t('login.title')}</h1>
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
        <a href={googleHref} className={`${btnPrimary} w-full mb-4`}>
          {t('login.google')}
        </a>

        {/* The other way in, for the audience this page actually gets: someone who
            followed a link while signed out. An invite link both signs them in and
            joins them, so it is strictly less work than this button. */}
        <p className="mb-6 text-center text-xs text-ink-muted leading-relaxed">
          {t('login.invite_note')}
        </p>
      </div>
    </div>
  );
}
