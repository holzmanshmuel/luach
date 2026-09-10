import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { sanitizeNext } from '@/lib/sanitize-next';
import { absoluteUrl } from '@/lib/absolute-url';

/**
 * Sign out, then go where the caller asked.
 *
 * The optional `?next=` is what makes the invite page's "use a different Google
 * account" link work: sign out, land back on /join/<token> signed out, and Google's
 * chooser (oauth.ts already forces prompt=select_account) offers the right account.
 * It runs through sanitizeNext, so it can only ever be a same-origin path and cannot
 * become an open redirect; anything else falls back to /login.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  // Destroy clears every field (userId, familyId, role, personId, …), so the next
  // request is fully signed out and the guards re-establish nothing from a stale cookie.
  session.destroy();
  await session.save();

  const next = sanitizeNext(request.nextUrl.searchParams.get('next'));
  return NextResponse.redirect(absoluteUrl(next ?? '/login', request));
}
