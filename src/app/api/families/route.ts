import { NextRequest, NextResponse } from 'next/server';
import { listActiveFamilies } from '@/lib/users';
import { safeEqual } from '@/lib/safe-equal';

export const dynamic = 'force-dynamic';

/**
 * Lists every family (id + name), for machine callers (n8n) that need to
 * iterate all tenants — e.g. calling the per-family notification/feed routes
 * in a loop. Token-gated with N8N_TOKEN, same auth mechanics as the other
 * N8N_TOKEN routes.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.N8N_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'N8N_TOKEN not configured on server.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const token = bearer ?? request.nextUrl.searchParams.get('token');
  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const families = await listActiveFamilies();
  return NextResponse.json({ families });
}
