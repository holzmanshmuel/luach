'use client';

import { useActionState } from 'react';
import { openInviteLinkAction } from './actions';
import { fieldLabel, fieldInput, btnGhost } from '@/app/components/Modal';

interface InviteLinkLabels {
  label: string;
  go: string;
}

/**
 * "Paste the invite link" — the escape hatch on /onboarding.
 *
 * This matters for this audience specifically: a relative reading a link off a
 * spouse's phone, or one that a WhatsApp forward mangled, previously had no way into
 * the family they were invited to. The only action /onboarding offered was CREATE,
 * so they made a second, empty family that is invisible to the real one and cannot
 * be merged with it.
 *
 * Ghost button, not primary: the create form below is the page's primary action for
 * the founder, and this is the reroute for everyone else.
 */
export function InviteLinkForm({ labels }: { labels: InviteLinkLabels }) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) =>
      openInviteLinkAction((formData.get('invite_link') as string) ?? ''),
    null
  );

  return (
    <form action={formAction} className="mt-4">
      <label htmlFor="invite_link" className={fieldLabel}>
        {labels.label}
      </label>
      <div className="flex items-end gap-2">
        {/* dir="ltr" and inputMode="url": the pasted value is always a Latin URL or
            token, even on an RTL page, and it must not be reordered while typing. */}
        <input
          type="text"
          id="invite_link"
          name="invite_link"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          className={`${fieldInput} flex-1 min-w-0`}
        />
        <button type="submit" disabled={isPending} className={`${btnGhost} shrink-0`}>
          {labels.go}
        </button>
      </div>

      {state?.error && (
        <p className="mt-2 text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{state.error}</p>
      )}
    </form>
  );
}
