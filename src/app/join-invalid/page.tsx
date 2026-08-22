import Link from 'next/link';
import { cookies } from 'next/headers';
import { getT, type Lang } from '@/lib/translations';

/**
 * Landing page for a failed invite redemption (Task 3.2-fix).
 *
 * The /join/<token> route handler redirects here on ANY redemption failure
 * (expired / revoked / bad token / already used) so it can keep the reason
 * opaque — this page shows one friendly bilingual message and never touches the
 * session. It must render signed-out too, so it does no auth/cookie writes and is
 * allowlisted in the proxy.
 *
 * Reuses the existing join.error_* translation keys the old join page used.
 */
export default async function JoinInvalidPage() {
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  return (
    <div
      className="min-h-screen bg-parchment flex items-center justify-center px-4"
      dir={dir}
    >
      <div className="w-full max-w-sm text-center bg-parchment-card rounded-2xl border border-warm-border p-8">
        <div className="sig-star text-5xl mb-4">✡</div>
        <h1 className="font-display text-2xl text-ink">{t('join.error_title')}</h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed">
          {t('join.error_body')}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block px-5 py-2.5 rounded-lg sig-primary text-sm"
        >
          {t('join.error_home')}
        </Link>
      </div>
    </div>
  );
}
