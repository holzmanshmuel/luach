'use server';

import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { query } from '@/lib/db';
import { FamilyMember } from '@/lib/types';
import { withAdmin } from '@/lib/auth';
import { bulkCreatePersonalTokens } from '@/lib/tokens';

export interface CardBundle {
  id: number;
  name: string;
  nickname: string | null;
  family_branch: string | null;
  photo_url: string | null;
  magicUrl: string;
  qrPng: string; // data URL
}

/**
 * Mint a fresh personal card (magic link + QR) for every family member. This is
 * a POST server action, NOT a GET render, so minting happens only on an explicit
 * admin click — never on page load or a prefetch. Regenerating revokes each
 * person's prior personal links (see createPersonalToken).
 *
 * withAdmin() still THROWS for non-admins, exactly as the bare requireAdmin() it
 * replaces did; what it adds is tenant context that survives into the body, which
 * both the member SELECT and the token minting need. See lib/auth.ts.
 */
export async function generateCardsAction(): Promise<{ error?: string; cards?: CardBundle[] }> {
  return withAdmin(async () => {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const origin = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') ?? `${proto}://${host}`;

    const members = await query<FamilyMember>(
      `SELECT * FROM family_calendar.family_members ORDER BY family_branch, name`
    );
    const tokens = await bulkCreatePersonalTokens(members.map(m => m.id), 'card-batch');

    const cards: CardBundle[] = [];
    for (const p of members) {
      const token = tokens.get(p.id);
      if (!token) continue;
      const magicUrl = `${origin}/magic/${token}`;
      const qrPng = await QRCode.toDataURL(magicUrl, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: 'M',
        color: { dark: '#1c1917', light: '#ffffff' },
      });
      cards.push({
        id: p.id,
        name: p.name,
        nickname: p.nickname ?? null,
        family_branch: p.family_branch ?? null,
        photo_url: p.photo_url ?? null,
        magicUrl,
        qrPng,
      });
    }
    return { cards };
  });
}
