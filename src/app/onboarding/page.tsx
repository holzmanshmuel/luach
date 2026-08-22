import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { OnboardingForm } from '@/app/components/OnboardingForm';
import { getT, type Lang } from '@/lib/translations';

/**
 * First-run onboarding: a signed-in user with NO family yet names their first
 * family and becomes its owner. The OAuth callback routes zero-membership users
 * here; the proxy allowlists this path so they aren't bounced to /login.
 *
 * This page must NOT use tenant-scoped query() — the visitor has no active family.
 * It only reads memberships via the systemQuery-backed helper.
 */
export default async function OnboardingPage() {
  const session = await getSession();

  // Signed-out visitors have nothing to onboard — send them to sign in.
  if (!session.userId) {
    redirect('/login');
  }

  // Already have a family? Nothing to onboard — go to the calendar.
  const memberships = await getMembershipsForUser(session.userId);
  if (memberships.length > 0) {
    redirect('/');
  }

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);

  return (
    <div
      className="min-h-screen bg-parchment flex items-center justify-center px-4"
      dir={lang === 'he' ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="sig-star text-5xl mb-4">✡</div>
          <h1 className="font-display text-3xl text-ink">{t('onboarding.welcome')}</h1>
          <p className="text-ink-muted mt-2 text-sm">{t('onboarding.subtitle')}</p>
        </div>

        <OnboardingForm
          labels={{
            nameLabel: t('onboarding.name_label'),
            namePlaceholder: t('onboarding.name_placeholder'),
            nameHeLabel: t('onboarding.name_he_label'),
            nameHePlaceholder: t('onboarding.name_he_placeholder'),
            create: t('onboarding.create'),
            creating: t('onboarding.creating'),
          }}
        />
      </div>
    </div>
  );
}
