export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { cookies } from 'next/headers';
import { listInviteTokens } from '@/lib/tokens';
import { AccessAdminPanel, type InvitePanelLabels } from './AccessAdminPanel';
import { requireAdmin } from '@/lib/auth';
import { getT, type Lang } from '@/lib/translations';

export default async function AccessAdminPage() {
  // /admin/* is coarse-gated to owners by the proxy; requireAdmin re-verifies the
  // live owner role AND establishes tenant context before the fan-out below.
  // listInviteTokens() calls a bare (RLS-scoped) query() with no guard of its own.
  await requireAdmin();

  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';
  const t = getT(lang);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  const invites = await listInviteTokens();

  const labels: InvitePanelLabels = {
    heading: t('invite.heading'),
    intro: t('invite.intro'),
    roleLabel: t('invite.role_label'),
    roleEditor: t('invite.role_editor'),
    roleViewer: t('invite.role_viewer'),
    labelPlaceholder: t('invite.label_placeholder'),
    generate: t('invite.generate'),
    activeHeading: t('invite.active_heading'),
    none: t('invite.none'),
    created: t('invite.created'),
    lastUsed: t('invite.last_used'),
    revoked: t('invite.revoked'),
    expired: t('invite.expired'),
    revoke: t('invite.revoke'),
    confirmRevoke: t('invite.confirm_revoke'),
    freshLinkLabel: t('invite.fresh_link'),
    copy: t('invite.copy'),
    copied: t('invite.copied'),
    showOnce: t('invite.show_once'),
  };

  return (
    <div className="min-h-screen bg-parchment" dir={dir}>
      <header className="bg-parchment-card border-b border-warm-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="sig-star text-xl leading-none">✡</span>
          <h1 className="font-display text-2xl font-medium text-ink tracking-wide">
            {t('invite.page_title')}
          </h1>
        </div>
        {/* The arrow lives in JSX and is chosen from `dir`, not baked into the
            translated label: 'invite.back' used to ship a literal '← ' that pointed
            the wrong way on the Hebrew page. */}
        <Link href="/" className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">
          <span aria-hidden>{dir === 'rtl' ? '→' : '←'}</span>
          {t('invite.back')}
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-ink-muted mb-6">{t('invite.page_intro')}</p>
        <AccessAdminPanel
          invites={invites.map(t => ({
            id: t.id,
            role: t.invite_role,
            label: t.label,
            createdAt: t.created_at,
            expired: t.expired, // derived in SQL (see listInviteTokens)
            lastUsedAt: t.last_used_at,
            revokedAt: t.revoked_at,
          }))}
          labels={labels}
        />
      </div>
    </div>
  );
}
