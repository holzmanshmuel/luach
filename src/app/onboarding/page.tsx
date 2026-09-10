import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { OnboardingForm } from '@/app/components/OnboardingForm';
import { Interpolated } from '@/app/components/Interpolated';
import { InviteLinkForm } from './InviteLinkForm';
import { familyLabel } from '@/lib/family-label';
import { getT, type Lang } from '@/lib/translations';
import { btnPrimary } from '@/lib/ui';

/**
 * First-run onboarding: a signed-in user with NO family yet. The OAuth callback
 * routes zero-membership users here; the proxy allowlists this path so they aren't
 * bounced to /login.
 *
 * ## Why there is a question above the form
 *
 * This is the ONE screen in the whole product where the app genuinely cannot know
 * whether somebody means to create a family or join one: signed in, zero
 * memberships, and no invite pending. Everywhere else the fork disappears — an
 * invitee arriving on /join/<token> is never asked.
 *
 * Before this, the only possible action here was CREATE. So a relative told "sign up
 * at family-calendar.holzman-ai.com" — no link — signed in and made a second, empty
 * family with the same surname, invisible to the real one and unmergeable with it.
 * Nothing on the page mentioned invites.
 *
 * The costs are asymmetric, and the layout follows them: the reroute question comes
 * FIRST because creating the wrong family is a silent, permanent mess, while failing
 * to create is a ten-second recovery. But the create form stays EXPANDED below it,
 * not behind a click, so the family founder — the person this page is really for —
 * never pays an extra tap.
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

  // Already have a family? Nothing to onboard — go to the calendar. (A second,
  // deliberate family is created at /families/new instead, which says so out loud.)
  const memberships = await getMembershipsForUser(session.userId);
  if (memberships.length > 0 && session.familyId) {
    redirect('/');
  }

  // ── Loop-breaker ──
  // Memberships but NO active family in the cookie. The proxy now sends every
  // family-less signed-in user here, and this page sends anyone with a membership to
  // '/', so redirecting blindly would ping-pong /→/onboarding→/ forever. Instead,
  // self-heal: offer to re-enter the newest family. /api/family/switch re-verifies
  // membership server-side and writes the session (which an RSC render cannot), so
  // one POST puts the cookie back in a valid state.
  //
  // No path in the app is known to produce this state — every join and every
  // creation sets familyId — but a redirect loop on a live family calendar is not
  // something to leave resting on that. Reuses the invite page's copy; no new strings.
  if (memberships.length > 0) {
    const cookieStore = await cookies();
    const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
    const t = getT(lang);
    const newest = memberships[0]; // getMembershipsForUser orders newest first
    const label = familyLabel(lang, newest.family_name, newest.family_name_he);
    return (
      <div
        className="min-h-screen bg-parchment flex items-center justify-center px-4"
        dir={lang === 'he' ? 'rtl' : 'ltr'}
      >
        <div className="w-full max-w-sm text-center bg-parchment-card rounded-2xl border border-warm-border p-8">
          <div className="sig-star text-5xl mb-4" aria-hidden>
            ✡
          </div>
          <h1 className="font-display text-2xl text-ink">
            <Interpolated template={t('invite_member.title')} placeholder="family" value={label} />
          </h1>
          <p className="text-ink-muted mt-3 text-sm leading-relaxed">{t('invite_member.body')}</p>
          <form method="post" action="/api/family/switch" className="mt-6">
            <input type="hidden" name="familyId" value={newest.family_id} />
            <button type="submit" className={btnPrimary}>
              {t('invite_member.open')}
            </button>
          </form>
        </div>
      </div>
    );
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
          <h1 className="font-display text-3xl text-ink">{t('onboarding.welcome')}</h1>
        </div>

        {/* ── Were you invited? ── the question that reroutes them, before the form
             that commits them. */}
        <section className="bg-parchment-card rounded-lg border border-warm-border p-6">
          <h2 className="font-display text-lg text-ink">{t('onboarding.invited_q')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm leading-relaxed">
            {t('onboarding.invited_body')}
          </p>
          <InviteLinkForm
            labels={{
              label: t('onboarding.invited_paste_label'),
              go: t('onboarding.invited_paste_go'),
            }}
          />
        </section>

        <hr className="my-7 border-warm-border" />

        {/* ── Or start a new one ── expanded, because for the founder this IS the
             page's primary action. */}
        <div className="mb-4">
          <h2 className="font-display text-lg text-ink">{t('onboarding.create_heading')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm leading-relaxed">
            {t('onboarding.subtitle')}
          </p>
        </div>

        <OnboardingForm
          autoFocusName={false}
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
