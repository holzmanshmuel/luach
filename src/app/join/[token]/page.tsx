export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getSession } from '@/lib/auth';
import { peekInvite } from '@/lib/tokens';
import { getMembership } from '@/lib/users';
import { resolveInviteState } from '@/lib/invite-state';
import { familyLabel } from '@/lib/family-label';
import { rateLimit } from '@/lib/ratelimit';
import { clientIpFrom } from '@/lib/client-ip';
import { getT, type Lang } from '@/lib/translations';
import { btnPrimary } from '@/lib/ui';
import { Interpolated } from '@/app/components/Interpolated';
import { InviteJoinButton } from './InviteJoinButton';

/**
 * The invite landing page — the app's real front door.
 *
 * Most people arrive at Luach from a WhatsApp message, not from /welcome. This page
 * used to be a GET route handler that redeemed the invite on sight and bounced a
 * signed-out visitor straight into Google, so a non-technical relative saw an
 * account chooser appear out of nowhere with no idea whose calendar they were
 * joining. Now the page NAMES THE FAMILY first and asks for a Google account
 * second, and redemption happens only when they press Join.
 *
 * ## Why this is a page and not a route handler any more
 *
 * Redemption writes the session cookie, and Next forbids cookie mutation during RSC
 * render — which is why it was a route handler in the first place. The fix is not to
 * render-and-write, it is to SPLIT them: this file renders and never writes a
 * cookie, and `joinFamilyAction` (a server action, POSTed from the Join button) does
 * the write. That also takes the membership mutation off a GET, which matters: an
 * in-app <Link> prefetch of a GET that joins would join silently, the same class of
 * bug this repo already carries a scar from on /api/logout.
 *
 * The URL is unchanged on purpose. Invite links live in family WhatsApp threads and
 * cannot be re-sent, so /join/<token> keeps working forever; the page replaces the
 * route handler at the same path rather than moving to a new one. `buildInviteLink`
 * and the proxy's `/join/` allowlist entry need no change.
 *
 * ## Constraints this file must keep
 *
 *  • Read-only. No cookie writes anywhere — see above.
 *  • No tenant-scoped query(). The visitor may have no family at all, so every
 *    lookup here goes through the systemQuery-backed helpers (peekInvite,
 *    getMembership), the same rule /onboarding follows.
 *  • Nothing that mutates may be a <Link>. The two buttons that act are a POSTed
 *    server action and a POSTed <form> to /api/family/switch.
 *  • noindex: the page is publicly fetchable and renders a family name, gated only
 *    by a 256-bit token, so a leaked link must never land in a search index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  // Brute-force guard the old route handler had (10/min per IP) and this page must
  // not lose. Keyed on the peek rather than the redemption because that is the read
  // an attacker would grind; the redemption itself is capped per USER in the action.
  // 30/min: a page render is cheap, and one family opens the same link on several
  // devices behind one home IP.
  const limit = rateLimit(`join-peek:${clientIpFrom(await headers())}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return (
      <Panel dir={dir}>
        <p className="text-ink-muted text-sm leading-relaxed">{t('login.rate_limited')}</p>
      </Panel>
    );
  }

  const peek = await peekInvite(token);
  const session = await getSession();

  // Membership is only asked about when there is a user to ask about, and only for a
  // token that resolved to a family.
  const isMember =
    session.userId != null && peek.familyId != null
      ? (await getMembership(session.userId, peek.familyId)) != null
      : false;

  const state = resolveInviteState({
    status: peek.status,
    isSignedIn: session.userId != null,
    isMember,
  });

  // An unknown token stays opaque — no family name, no reason, same page a mistyped
  // link has always produced.
  if (state === 'invalid') {
    redirect('/join-invalid');
  }

  // Every remaining state has a family (peekInvite only omits it for 'unknown').
  const family = familyLabel(lang, peek.familyName!, peek.familyNameHe);

  if (state === 'already_member') {
    return (
      <Panel dir={dir}>
        <h1 className="font-display text-2xl text-ink">
          <Interpolated template={t('invite_member.title')} placeholder="family" value={family} />
        </h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed">{t('invite_member.body')}</p>
        {/* A POSTed form, not a link: this both acknowledges and SWITCHES the
            session to that family, which is what a relative who holds several
            actually wants. /api/family/switch re-verifies membership server-side, so
            the client-supplied id is safe. Nothing on this render touched the
            session — which is why an owner checking their own invite link can no
            longer lose their admin pages here. */}
        <form method="post" action="/api/family/switch" className="mt-6">
          <input type="hidden" name="familyId" value={peek.familyId!} />
          <button type="submit" className={btnPrimary}>
            {t('invite_member.open')}
          </button>
        </form>
      </Panel>
    );
  }

  if (state === 'expired' || state === 'revoked') {
    const titleKey = state === 'expired' ? 'invite_expired.title' : 'invite_revoked.title';
    const bodyKey = state === 'expired' ? 'invite_expired.body' : 'invite_revoked.body';
    return (
      <Panel dir={dir}>
        <h1 className="font-display text-2xl text-ink">{t(titleKey)}</h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed">
          <Interpolated template={t(bodyKey)} placeholder="family" value={family} />
        </p>
      </Panel>
    );
  }

  if (state === 'sign_in') {
    return (
      <Panel dir={dir}>
        <h1 className="font-display text-2xl text-ink">
          <Interpolated template={t('invite_land.title')} placeholder="family" value={family} />
        </h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed">{t('invite_land.body')}</p>
        {/* Plain <a> to the OAuth entry route, carrying ?next back to this exact
            link: it mints the CSRF state, and the callback honours a pending /join/
            redirect even for a brand-new user with no family (rather than dropping
            the invite and sending them to onboarding). No create affordance on this
            page — an invitee must never be offered a second, empty family. */}
        <a
          href={`/api/auth/google?next=/join/${encodeURIComponent(token)}`}
          className={`${btnPrimary} mt-6 w-full`}
        >
          {t('invite_land.signin')}
        </a>
        <p className="mt-4 text-xs text-ink-faint leading-relaxed">
          {t('invite_land.privacy_note')}
        </p>
      </Panel>
    );
  }

  // state === 'confirm' — live invite, signed in, not a member yet.
  const roleBody =
    peek.role === 'viewer' ? t('invite_confirm.body_viewer') : t('invite_confirm.body_editor');

  return (
    <Panel dir={dir}>
      <h1 className="font-display text-2xl text-ink">
        <Interpolated template={t('invite_confirm.title')} placeholder="family" value={family} />
      </h1>
      <p className="text-ink-muted mt-3 text-sm leading-relaxed">{roleBody}</p>

      <InviteJoinButton token={token} label={t('invite_confirm.join')} />

      {/* Which account they landed on, and a one-tap way out of the wrong one.
          oauth.ts already forces prompt=select_account, so Google always shows the
          chooser — but on a shared family phone the chooser can still be answered
          wrong, and until now there was nothing on screen saying so. The link signs
          them out and returns here, where the chooser runs again. Plain <a>: a
          <Link> prefetch of this destructive GET would sign them out on page load. */}
      {session.userEmail && (
        <p className="mt-5 text-xs text-ink-faint leading-relaxed">
          <Interpolated
            template={t('invite_confirm.signed_in_as')}
            placeholder="email"
            value={session.userEmail}
          />
        </p>
      )}
      <a
        href={`/api/logout?next=/join/${encodeURIComponent(token)}`}
        className="mt-1 inline-block text-xs text-ink-2 underline underline-offset-4 decoration-1 hover:text-ink transition-colors"
      >
        {t('invite_confirm.switch_account')}
      </a>
    </Panel>
  );
}

/** The shared card shell — same shape /join-invalid and /onboarding already use. */
function Panel({ dir, children }: { dir: 'rtl' | 'ltr'; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4" dir={dir}>
      <div className="w-full max-w-sm text-center bg-parchment-card rounded-2xl border border-warm-border p-8">
        <div className="sig-star text-5xl mb-4" aria-hidden>
          ✡
        </div>
        {children}
      </div>
    </div>
  );
}
