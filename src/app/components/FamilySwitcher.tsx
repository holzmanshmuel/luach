import type { Membership } from '@/lib/users';
import { getT, type Lang } from '@/lib/translations';
import { btnPrimary } from '@/lib/ui';

/**
 * Family switcher (Task 2.4 → Task 6 multi-select combined view). Renders
 * ONLY when the signed-in user holds ≥2 memberships — a single-family user
 * sees nothing extra in the header.
 *
 * Zero client state: ONE <form method="post"> posts every checked family's
 * id to /api/family/view. The route handler re-verifies membership
 * server-side before touching the session (see that route's comment) — this
 * component never has to trust its own list. Checking exactly one family
 * behaves like a plain switch; checking two or more turns on the combined
 * (merged) view.
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
  if (memberships.length < 2) return null;
  const t = getT(lang);
  const selected = new Set(selectedIds);

  return (
    <details className="relative">
      <summary
        className="label hover:text-ink flex items-center gap-1.5 transition-colors cursor-pointer select-none list-none"
        aria-label={t('switcher.label')}
        title={t('switcher.label')}
      >
        <span aria-hidden>🏠</span>
        <span className="hidden sm:inline">{t('switcher.label')}</span>
      </summary>
      <form
        method="post"
        action="/api/family/view"
        className="absolute end-0 top-full mt-2 min-w-56 rounded-md border border-warm-border bg-parchment-card shadow-lg py-1 z-20"
      >
        {memberships.map((m) => {
          const isCurrent = m.family_id === activeFamilyId;
          const name = lang === 'he' && m.family_name_he ? m.family_name_he : m.family_name;
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
                {name}
                {isCurrent && (
                  <span className="ms-1.5 text-xs text-ink-faint">({t('switcher.current')})</span>
                )}
              </span>
            </label>
          );
        })}
        <div className="mt-1 border-t border-warm-border px-3 pt-2 pb-1.5">
          <p className="text-xs text-ink-faint mb-2">{t('switcher.combine_hint')}</p>
          <button type="submit" className={`${btnPrimary} w-full`}>
            {t('switcher.show')}
          </button>
        </div>
      </form>
    </details>
  );
}
