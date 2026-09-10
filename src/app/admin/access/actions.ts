'use server';

import { revalidatePath } from 'next/cache';
import { withAdminOrError } from '@/lib/auth';
import {
  createInviteToken,
  revokeToken as revokeTokenQuery,
  type InviteRole,
} from '@/lib/tokens';
import { headers } from 'next/headers';

/** Build the public /join/<token> invite URL from the configured origin. */
async function buildInviteLink(token: string): Promise<string> {
  // Prefer NEXTAUTH_URL (set in prod); otherwise derive from the forwarded
  // request host so the link is correct in dev/staging too.
  let base = process.env.NEXTAUTH_URL?.replace(/\/+$/, '');
  if (!base) {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    base = host ? `${proto}://${host}` : '';
  }
  return `${base}/join/${token}`;
}

/**
 * Both actions mint or revoke rows in the tenant-scoped `access_tokens` table, so
 * the write must run INSIDE the tenant callback — `withAdminOrError` verifies the
 * owner live and then runs the body under runWithTenant(). A bare
 * `await requireAdmin()` here left the following query() with no tenant; see the
 * note in lib/auth.ts. The role check stays inside the callback so the owner check
 * still comes first and a stranger learns nothing about the argument.
 */
export async function createInviteAction(
  role: InviteRole,
  label: string | null,
): Promise<{ error?: string; url?: string }> {
  return withAdminOrError(async () => {
    if (role !== 'editor' && role !== 'viewer') {
      return { error: 'Pick a role.' };
    }
    const token = await createInviteToken(role, label || null);
    revalidatePath('/admin/access');
    return { url: await buildInviteLink(token) };
  });
}

export async function revokeTokenAction(id: number): Promise<{ error?: string }> {
  return withAdminOrError(async () => {
    await revokeTokenQuery(id);
    revalidatePath('/admin/access');
    return {};
  });
}
