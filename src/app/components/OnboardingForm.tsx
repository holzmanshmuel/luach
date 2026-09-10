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

/**
 * The name-your-family form. Used by first-run /onboarding AND by /families/new
 * ("start another calendar") — both call the same createFamilyAction, which never
 * cared how many families the user already had.
 *
 * `autoFocusName` defaults to true, but /onboarding passes false: on that page the
 * "were you invited?" question sits ABOVE this form, and stealing focus down into the
 * create field would pull the reader past the question that reroutes them.
 */
export function OnboardingForm({
  labels,
  autoFocusName = true,
}: {
  labels: OnboardingLabels;
  autoFocusName?: boolean;
}) {
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
          autoFocus={autoFocusName}
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
