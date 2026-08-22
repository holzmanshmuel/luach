'use client';

import { Modal, btnPrimary, btnGhost } from './Modal';
import { useCombinedMode } from './CombinedModeProvider';
import { useUserPrefs } from './UserPrefsContext';

/**
 * Combined (merged) view is read-only — an add/edit affordance that would
 * normally open a real form instead opens this notice, explaining why and
 * offering a one-click "Switch to {family}" button per viewed family. Each
 * button posts straight to the existing single-family switch route, so
 * confirming lands the user back in that family's own editable view.
 */
export function CombinedModeNotice({ onClose }: { onClose: () => void }) {
  const { viewFamilies } = useCombinedMode();
  const { t, language } = useUserPrefs();

  return (
    <Modal title={t('combined.notice_title')} onClose={onClose}>
      <p className="text-sm text-ink-muted mb-4">{t('combined.notice_body')}</p>

      <div className="space-y-2">
        {viewFamilies.map(f => {
          const label = language === 'he' && f.nameHe ? f.nameHe : f.name;
          return (
            <form key={f.id} method="post" action="/api/family/switch">
              <input type="hidden" name="familyId" value={f.id} />
              <button type="submit" className={`${btnPrimary} w-full flex items-center justify-center gap-2`}>
                <span
                  style={{ backgroundColor: f.color }}
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  aria-hidden
                />
                {t('combined.switch_to').replace('{name}', label)}
              </button>
            </form>
          );
        })}
      </div>

      <button type="button" onClick={onClose} className={`${btnGhost} w-full mt-3`}>
        {t('person.cancel')}
      </button>
    </Modal>
  );
}
