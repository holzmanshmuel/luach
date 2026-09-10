export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { getT, type Lang } from '@/lib/translations';

/**
 * Landing page for a token that does not resolve at all — garbage, mistyped, or a
 * shared/personal card link used as an invite.
 *
 * This is now the ONLY case that lands here. An expired or revoked invite is
 * answered on /join/<token> itself, which can name the family and say what to do
 * about it; this page deliberately keeps the reason opaque because there is nothing
 * to name and no reason worth leaking.
 *
 * The button is session-aware. It used to be a single hard-coded link to /login,
 * which for a signed-in member was a dead end telling them to sign in again — and
 * /login now redirects signed-in visitors away, so a fixed link here would have
 * bounced twice. Both reads go through the systemQuery-backed helpers because this
 * page renders for visitors with no family and no session at all.
 *
 * Writes NO cookies: it is allowlisted in the proxy on that basis, and it must keep
 * rendering for a signed-out visitor.
 */
export default async function JoinInvalidPage() {
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  const session = await getSession();
  let href = '/login';
  let label = t('join.error_home');
  if (session.userId) {
    const memberships = await getMembershipsForUser(session.userId);
    if (memberships.length > 0) {
      href = '/';
      label = t('join.error_home_calendar');
    } else {
      href = '/onboarding';
      label = t('join.error_home_start');
    }
  }

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
          href={href}
          className="mt-6 inline-block px-5 py-2.5 rounded-lg sig-primary text-sm"
        >
          {label}
        </Link>
      </div>
    </div>
  );
}
