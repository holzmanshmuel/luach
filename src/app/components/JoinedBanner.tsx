import { getT, type Lang } from '@/lib/translations';
import { Interpolated } from './Interpolated';

/**
 * "You are in the <family> calendar" — the confirmation a relative gets after
 * redeeming an invite.
 *
 * Redemption used to redirect to `/?joined=1` and NOTHING read that param, so
 * somebody who had just been added landed on a dense calendar with no sign that
 * anything had happened. This banner is what `?joined=1` now drives.
 *
 * A Server Component with no state, no dismiss button and no client JS: the param is
 * gone on the next navigation, which is the whole dismissal mechanism. Deliberately
 * NOT built on WelcomeBanner — that one is localStorage-gated and would suppress
 * itself for a relative who has already seen it once, which is exactly the person
 * joining a second family.
 */
export function JoinedBanner({ lang, familyLabel }: { lang: Lang; familyLabel: string }) {
  const t = getT(lang);
  return (
    <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-4 flex items-start gap-3">
      <span className="text-xl leading-none" aria-hidden>
        🎉
      </span>
      <div className="flex-1">
        <p className="font-display text-lg text-ink mb-0.5">
          <Interpolated template={t('joined.title')} placeholder="family" value={familyLabel} />
        </p>
        <p className="text-sm text-ink-2">{t('joined.body')}</p>
      </div>
    </div>
  );
}
