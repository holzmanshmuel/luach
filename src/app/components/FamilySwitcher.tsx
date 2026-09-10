import Link from 'next/link';
import type { Membership } from '@/lib/users';
import { getT, type Lang } from '@/lib/translations';
import { familyLabel } from '@/lib/family-label';
import { btnPrimary } from '@/lib/ui';

/**
 * Family switcher (Task 2.4 → Task 6 multi-select combined view).
 *
 * Renders from ONE membership, not two. It used to hide itself below two, which cost
 * a single-family user two things: any on-screen indication of which family they were
 * in, and — because "start another calendar" lives inside this menu, the way it does
 * in Slack, Notion, Linear and Figma — any way to reach a second family at all.
 * /onboarding redirects anyone who already has one, so there was no other door.
 *
 * Zero client state: ONE <form method="post"> posts every checked family's id to
 * /api/family/view. The route handler re-verifies membership server-side before
 * touching the session (see that route's comment) — this component never has to trust
 * its own list. Checking exactly one family behaves like a plain switch; checking two
 * or more turns on the combined (merged) view. The merge controls only appear at ≥2
 * memberships, because there is nothing to merge below that.
 *
 * The "start another calendar" link sits OUTSIDE the <form> — inside it, a click would
 * be swallowed by the submit region.
 */
export function FamilySwitcher({
  lang,
  memberships,
  activeFamilyId,
  selectedIds,
}: {
  lang: Lang;
  memberships: Membership[];
  activeFamilyId: number;
  selectedIds: number[];
}) {
  if (memberships.length < 1) return null;
  const t = getT(lang);
  const selected = new Set(selectedIds);
  const canCombine = memberships.length >= 2;

  const active = memberships.find(m => m.family_id === activeFamilyId);
  const activeLabel = active
    ? familyLabel(lang, active.family_name, active.family_name_he)
    : t('switcher.label');

  return (
    <details className="relative">
      <summary
        className="label hover:text-ink flex items-center gap-1.5 transition-colors cursor-pointer select-none list-none"
        aria-label={t('switcher.label')}
        title={t('switcher.label')}
      >
        <span aria-hidden>🏠</span>
        {/* The ACTIVE family's name, so a one-family user can see where they are.
            <bdi> isolates it: a Latin surname inside the RTL header would otherwise
            be reordered against its neighbours. */}
        <span className="hidden sm:inline max-w-32 truncate">
          <bdi>{activeLabel}</bdi>
        </span>
      </summary>
      <div className="absolute end-0 top-full mt-2 min-w-56 rounded-md border border-warm-border bg-parchment-card shadow-lg py-1 z-20">
        {/* Plain small text, not the brand's `.label` eyebrow: that class is mono +
            uppercase, and Hebrew has no uppercase — an all-caps Latin heading beside
            Hebrew menu rows reads as a mismatch. */}
        <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-ink-faint">
          {t('switcher.heading')}
        </p>
        <form method="post" action="/api/family/view">
          {memberships.map((m) => {
            const isCurrent = m.family_id === activeFamilyId;
            const name = familyLabel(lang, m.family_name, m.family_name_he);
            return (
              <label
                key={m.family_id}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-parchment cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  name="familyId"
                  value={m.family_id}
                  defaultChecked={selected.has(m.family_id)}
                  className="shrink-0 accent-[#4C4F30]"
                />
                <span className={isCurrent ? 'text-ink font-medium' : ''}>
                  <bdi>{name}</bdi>
                  {isCurrent && (
                    <span className="ms-1.5 text-xs text-ink-faint">({t('switcher.current')})</span>
                  )}
                </span>
              </label>
            );
          })}
          {canCombine && (
            <div className="mt-1 border-t border-warm-border px-3 pt-2 pb-1.5">
              <p className="text-xs text-ink-faint mb-2">{t('switcher.combine_hint')}</p>
              <button type="submit" className={`${btnPrimary} w-full`}>
                {t('switcher.show')}
              </button>
            </div>
          )}
        </form>
        <div className="mt-1 border-t border-warm-border">
          <Link
            href="/families/new"
            className="block px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-parchment transition-colors"
          >
            {t('switcher.new')}
          </Link>
        </div>
      </div>
    </details>
  );
}
