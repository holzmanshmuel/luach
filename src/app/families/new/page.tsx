export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { OnboardingForm } from '@/app/components/OnboardingForm';
import { getT, type Lang } from '@/lib/translations';

/**
 * Start ANOTHER family calendar — the door that was missing.
 *
 * Luach has always allowed several memberships and has a combined view for people
 * who belong to two families (your side and your in-laws'), but nothing in the UI
 * could create a second one: /onboarding redirects anyone who already has a family,
 * and the family switcher did not render below two memberships. So a user with one
 * family had no path to a second at all. The switcher now renders from one
 * membership and links here.
 *
 * Reuses `createFamilyAction` unchanged — that action never checked the membership
 * count (only /onboarding's page guard did), and it keeps the 5-families-per-day
 * abuse cap.
 *
 * No proxy allowlist entry is needed: anyone with ≥1 membership has `familyId` set,
 * so the cookie gate passes. A family-less user who guesses this URL is bounced by
 * the gate to /onboarding, which is where they belong.
 *
 * This page must NOT use tenant-scoped query() — it only reads memberships through
 * the systemQuery-backed helper, same as /onboarding.
 */
export default async function NewFamilyPage() {
  const session = await getSession();
  if (!session.userId) {
    redirect('/login?from=/families/new');
  }

  // No family yet? Then this is a FIRST family, and onboarding is the page that
  // asks the one question worth asking there ("were you invited?").
  const memberships = await getMembershipsForUser(session.userId);
  if (memberships.length === 0) {
    redirect('/onboarding');
  }

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);

  return (
    <div
      className="min-h-screen bg-parchment flex items-center justify-center px-4 py-10"
      dir={lang === 'he' ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="sig-star text-5xl mb-4" aria-hidden>
            ✡
          </div>
          <h1 className="font-display text-3xl text-ink">{t('newfamily.title')}</h1>
          <p className="text-ink-muted mt-2 text-sm leading-relaxed">{t('newfamily.body')}</p>
        </div>

        {/* The mirror mistake: somebody who meant to INVITE relatives into the
            calendar they already have, and instead creates a second, empty one that
            nobody else can see. Two unmergeable families is the expensive outcome,
            so the alternative is offered before the form, not after it. */}
        <p className="mb-5 rounded-md bg-accent-soft/50 border border-warm-border px-3 py-2 text-xs text-ink-2 leading-relaxed">
          {t('newfamily.warn')}{' '}
          <Link
            href="/admin/access"
            className="underline underline-offset-4 decoration-1 hover:text-ink transition-colors"
          >
            {t('newfamily.warn_link')}
          </Link>
        </p>

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

        <div className="mt-5 text-center">
          <Link
            href="/"
            className="text-sm text-ink-2 underline underline-offset-4 decoration-1 hover:text-ink transition-colors"
          >
            {t('newfamily.cancel')}
          </Link>
        </div>
      </div>
    </div>
  );
}
