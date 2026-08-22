'use client';

import { useActionState } from 'react';
import { createFamilyAction } from '@/app/onboarding/actions';
import { fieldLabel, fieldInput, btnPrimary } from './Modal';

interface OnboardingLabels {
  nameLabel: string;
  namePlaceholder: string;
  nameHeLabel: string;
  nameHePlaceholder: string;
  create: string;
  creating: string;
}

export function OnboardingForm({ labels }: { labels: OnboardingLabels }) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      return createFamilyAction({
        name: (formData.get('name') as string) ?? '',
        name_he: (formData.get('name_he') as string) ?? '',
      });
    },
    null
  );

  return (
    <form action={formAction} className="bg-parchment-card rounded-lg border border-warm-border p-6 space-y-5">
      <div>
        <label htmlFor="name" className={fieldLabel}>
          {labels.nameLabel}
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          maxLength={80}
          autoFocus
          autoComplete="off"
          className={fieldInput}
          placeholder={labels.namePlaceholder}
        />
      </div>

      <div>
        <label htmlFor="name_he" className={fieldLabel}>
          {labels.nameHeLabel}
        </label>
        <input
          type="text"
          id="name_he"
          name="name_he"
          dir="rtl"
          maxLength={80}
          autoComplete="off"
          className={fieldInput}
          placeholder={labels.nameHePlaceholder}
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={isPending} className={`${btnPrimary} w-full`}>
        {isPending ? labels.creating : labels.create}
      </button>
    </form>
  );
}
