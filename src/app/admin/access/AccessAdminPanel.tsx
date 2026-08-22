'use client';

import { useState, useTransition } from 'react';
import { createInviteAction, revokeTokenAction } from './actions';

interface InviteView {
  id: number;
  role: 'editor' | 'viewer';
  label: string | null;
  createdAt: string;
  /** Computed on the server (this page is dynamic) to keep render pure. */
  expired: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface InvitePanelLabels {
  heading: string;
  intro: string;
  roleLabel: string;
  roleEditor: string;
  roleViewer: string;
  labelPlaceholder: string;
  generate: string;
  activeHeading: string;
  none: string;
  created: string;
  lastUsed: string;
  revoked: string;
  expired: string;
  revoke: string;
  confirmRevoke: string;
  freshLinkLabel: string;
  copy: string;
  copied: string;
  showOnce: string;
}

function CopyField({ url, copy, copied }: { url: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        className="flex-1 text-xs bg-parchment-dark border border-warm-border rounded-lg px-2 py-1.5 font-mono text-ink"
        onClick={e => (e.target as HTMLInputElement).select()}
      />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="text-xs px-3 py-1.5 rounded-lg sig-primary transition-opacity"
      >
        {done ? copied : copy}
      </button>
    </div>
  );
}

export function AccessAdminPanel({
  invites,
  labels,
}: {
  invites: InviteView[];
  labels: InvitePanelLabels;
}) {
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [label, setLabel] = useState('');

  function handleCreate() {
    startTransition(async () => {
      const result = await createInviteAction(role, label || null);
      if (result.url) {
        setFlash(result.url);
        setLabel('');
      }
    });
  }

  function handleRevoke(id: number) {
    if (!confirm(labels.confirmRevoke)) return;
    startTransition(async () => {
      await revokeTokenAction(id);
    });
  }

  return (
    <div className="space-y-8">
      {flash && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {labels.freshLinkLabel}
          </p>
          <CopyField url={flash} copy={labels.copy} copied={labels.copied} />
          <p className="text-[11px] text-amber-700">{labels.showOnce}</p>
        </div>
      )}

      <section className="rounded-2xl border border-warm-border bg-parchment-card p-5 space-y-3">
        <header>
          <h2 className="font-display text-lg text-ink">{labels.heading}</h2>
          <p className="text-xs text-ink-muted">{labels.intro}</p>
        </header>
        <div className="grid gap-2 sm:grid-cols-[auto,1fr,auto] items-center">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted whitespace-nowrap">{labels.roleLabel}</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'editor' | 'viewer')}
              className="text-sm rounded-lg border border-warm-border bg-parchment px-3 py-2"
            >
              <option value="editor">{labels.roleEditor}</option>
              <option value="viewer">{labels.roleViewer}</option>
            </select>
          </label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={labels.labelPlaceholder}
            className="text-sm rounded-lg border border-warm-border bg-parchment px-3 py-2"
          />
          <button
            onClick={handleCreate}
            disabled={pending}
            className="px-4 py-2 rounded-lg sig-primary text-sm hover:opacity-80 disabled:opacity-50"
          >
            {labels.generate}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-warm-border bg-parchment-card p-5 space-y-3">
        <header>
          <h2 className="font-display text-lg text-ink">{labels.activeHeading}</h2>
        </header>
        {invites.length === 0 ? (
          <p className="text-xs text-ink-muted">{labels.none}</p>
        ) : (
          <ul className="text-xs space-y-1 mt-2">
            {invites.map(t => {
              const dead = !!t.revokedAt || t.expired;
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1">
                  <span className={dead ? 'text-ink-faint line-through' : 'text-ink-muted'}>
                    <span className="font-medium">
                      {t.role === 'editor' ? labels.roleEditor : labels.roleViewer}
                    </span>
                    {t.label && ` · ${t.label}`}
                    {' · '}{labels.created} {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt && ` · ${labels.lastUsed} ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                    {t.revokedAt && ` · ${labels.revoked}`}
                    {!t.revokedAt && t.expired && ` · ${labels.expired}`}
                  </span>
                  {!dead && (
                    <button
                      onClick={() => handleRevoke(t.id)}
                      className="text-[11px] text-red-600 hover:text-red-800 shrink-0"
                    >
                      {labels.revoke}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
