import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getT, type Lang } from '@/lib/translations';
import { REPO_URL } from '@/lib/ui';

// Button classes are defined locally rather than imported from Modal.tsx: that
// module is `'use client'`, and importing a bare string constant from a client
// module into a server component turns it into a client reference (its value
// serializes as a thrown-error stub, not the class string) — so the styles are
// silently dropped. Redeclaring the Signal pill-button classes here keeps this
// server page self-contained and correctly styled.
const ctaButton =
  'sig-primary inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors';

export const metadata: Metadata = {
  title: 'Hebrew-English Family Calendar',
  description:
    'Every birthday, anniversary and yahrzeit — in both Hebrew and Gregorian dates, shared with the whole family.',
};

/**
 * Public marketing front door. Unauthenticated visitors to `/` are redirected
 * here by the proxy; `/login` stays the lightweight sign-in page for invite and
 * error flows. This is the product's face (and Holzman AI's calling card), so it
 * leans into what makes the calendar distinctive: it is genuinely bilingual.
 *
 * Rather than gate the hero behind a client-side language toggle (which would
 * pull in the UserPrefsProvider client component and a router.refresh on a page
 * that has no tenant), we render the primary copy bilingually STACKED — English
 * and Hebrew both visible — which also demonstrates the core feature at a glance.
 * The reader's chosen `lang` cookie (if any) still drives which language leads
 * for the supporting copy and the html dir from the root layout.
 */
export default async function WelcomePage() {
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const en = getT('en');
  const he = getT('he');
  const rtl = lang === 'he';

  const features = [
    { title: 'landing.feature1.title', body: 'landing.feature1.body' },
    { title: 'landing.feature2.title', body: 'landing.feature2.body' },
    { title: 'landing.feature3.title', body: 'landing.feature3.body' },
  ];

  const steps = ['landing.how.step1', 'landing.how.step2', 'landing.how.step3'];

  return (
    <main
      dir={rtl ? 'rtl' : 'ltr'}
      className="min-h-screen bg-parchment text-ink-2"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-24">
        {/* ── Hero ── */}
        <section className="text-center">
          <div className="sig-star text-5xl sm:text-6xl mb-6" aria-hidden="true">
            ✡
          </div>

          {/* Bilingual stacked H1 — the product IS the two calendars side by side. */}
          <h1 className="font-display text-3xl sm:text-5xl font-medium text-ink leading-tight">
            <span dir="ltr" className="block">
              {en('landing.h1')}
            </span>
            <span
              dir="rtl"
              className="block mt-2 text-2xl sm:text-4xl text-accent"
            >
              {he('landing.h1')}
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base sm:text-lg text-ink-2">
            {t('landing.sub')}
          </p>

          {/* Primary CTA → Google OAuth entry route (mints CSRF state, redirects). */}
          <div className="mt-9 flex flex-col items-center gap-3">
            <a href="/api/auth/google" className={`${ctaButton} px-7 py-3 text-base`}>
              {t('landing.cta')}
            </a>
            {/* ONE affordance, then two notes. There used to be a second
                underlined link here for returning members (HOLZMAN-152) pointing at
                the IDENTICAL /api/auth/google URL — two labels for one destination,
                which reads as a choice a visitor can get wrong and is exactly the
                phantom fork this page should not have. The callback already routes by
                membership (existing family → /, none → /onboarding), so the button
                genuinely serves both audiences; the note just says so.

                No .ennote on either note — that class forces direction:ltr + mono for
                Latin fragments, and these strings are translated, so in Hebrew it
                rendered the copy LTR in monospace. */}
            <p className="text-sm text-ink-2">{t('landing.entry_note')}</p>
            <p className="text-xs text-ink-muted">{t('landing.invite')}</p>
          </div>
        </section>

        {/* ── Feature cards ── */}
        <section className="mt-16 sm:mt-24 grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-parchment-card border border-warm-border rounded-lg p-5 text-start"
            >
              <h2 className="font-display text-lg text-ink mb-1.5">
                {t(f.title)}
              </h2>
              <p className="text-sm text-ink-muted leading-relaxed">
                {t(f.body)}
              </p>
            </div>
          ))}
        </section>

        {/* ── How it works ── */}
        <section className="mt-16 sm:mt-24">
          <div className="sec-label mb-6">{t('landing.how.title')}</div>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li
                key={s}
                className="flex items-start gap-3 bg-parchment-card border border-warm-border rounded-lg p-4"
              >
                <span
                  className="sig-accent shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="text-sm text-ink-2 leading-snug">{t(s)}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Closing CTA ── */}
        <section className="mt-16 sm:mt-24 text-center">
          <a href="/api/auth/google" className={`${ctaButton} px-7 py-3 text-base`}>
            {t('landing.cta')}
          </a>
        </section>

        {/* ── Open source ── quiet, below the CTA: it matters to the few
             visitors who would rather run their own copy than sign up here. */}
        <p className="mt-10 text-center text-sm text-ink-muted">
          {t('landing.source')}{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener"
            className="ennote text-ink-2 underline underline-offset-4 decoration-warm-border hover:text-ink hover:decoration-ink transition-colors"
          >
            {t('landing.source_link')}
          </a>
        </p>
      </div>
    </main>
  );
}
