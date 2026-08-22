'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
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

export async function createInviteAction(
  role: InviteRole,
  label: string | null,
): Promise<{ error?: string; url?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: 'Admin access required.' };
  }
  if (role !== 'editor' && role !== 'viewer') {
    return { error: 'Pick a role.' };
  }
  const token = await createInviteToken(role, label || null);
  revalidatePath('/admin/access');
  return { url: await buildInviteLink(token) };
}

export async function revokeTokenAction(id: number): Promise<{ error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: 'Admin access required.' };
  }
  await revokeTokenQuery(id);
  revalidatePath('/admin/access');
  return {};
}
