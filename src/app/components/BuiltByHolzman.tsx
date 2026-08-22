import { getT, type Lang } from '@/lib/translations';
import { REPO_URL } from '@/lib/ui';

/**
 * Quiet brand credit, rendered on every view via the root layout.
 * Understated by design: small type, muted ink, a hairline top border —
 * a signature, not an ad.
 */
export function BuiltByHolzman({ lang }: { lang: Lang }) {
  const t = getT(lang);
  return (
    <footer className="border-t border-warm-border py-4 text-center">
      <p className="text-xs text-ink-faint">
        {t('footer.built_by')}{' '}
        <a
          href="https://holzman-ai.com"
          target="_blank"
          rel="noopener"
          className="ennote text-ink-muted hover:text-ink transition-colors"
        >
          Holzman AI
        </a>
        <span aria-hidden="true" className="mx-2 text-ink-faint">
          ·
        </span>
        <a
          href="mailto:holzmanshmuel@gmail.com?subject=Family%20Calendar%20help"
          className="text-ink-muted hover:text-ink transition-colors"
        >
          {t('footer.need_help')}
        </a>
        <span aria-hidden="true" className="mx-2 text-ink-faint">
          ·
        </span>
        <a
          href="/privacy"
          className="text-ink-muted hover:text-ink transition-colors"
        >
          {t('footer.privacy')}
        </a>
        <span aria-hidden="true" className="mx-2 text-ink-faint">
          ·
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener"
          className="text-ink-muted hover:text-ink transition-colors"
        >
          {t('footer.source')}
        </a>
      </p>
    </footer>
  );
}
