'use client';

import { useActionState } from 'react';
import { joinFamilyAction } from './actions';
import { btnPrimary } from '@/app/components/Modal';

/**
 * The Join button on the invite confirmation screen.
 *
 * A tiny client wrapper so /join/[token]/page.tsx stays a Server Component: only the
 * pending/error state needs the client, and the label arrives as a prop rather than
 * pulling `getT` across the boundary (the same shape OnboardingForm and
 * AccessAdminPanel use). Submitting a <form> means the redemption is a POST, never a
 * prefetchable GET.
 */
export function InviteJoinButton({ token, label }: { token: string; label: string }) {
  const [state, formAction, isPending] = useActionState(
    async () => joinFamilyAction(token),
    null as { error?: string } | null
  );

  return (
    <form action={formAction} className="mt-6">
      {state?.error && (
        <p className="mb-3 text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{state.error}</p>
      )}
      <button type="submit" disabled={isPending} className={`${btnPrimary} w-full`}>
        {label}
      </button>
    </form>
  );
}
