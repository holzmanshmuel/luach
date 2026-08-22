import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMembership } from '@/lib/users';
import { absoluteUrl } from '@/lib/absolute-url';

/**
 * Family switcher (Task 2.4). Plain <form method="post"> target — zero client JS
 * required — so the switcher UI in the header works with cookies alone.
 *
 * Security: the target familyId is client-supplied and therefore UNTRUSTED. We
 * NEVER flip the session to a family without first verifying, live against the
 * DB, that the signed-in user actually holds a membership in it — otherwise a
 * forged request could pin a user's session (and every subsequent tenant-scoped
 * query) onto a family they have no right to see. This mirrors the same
 * verify-then-enterTenant discipline as establishTenant()/requireAuth() in
 * src/lib/auth.ts.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(absoluteUrl('/login', request), { status: 303 });
  }

  const form = await request.formData();
  const raw = form.get('familyId');
  const target = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(target) || target <= 0) {
    return NextResponse.json({ error: 'Invalid familyId' }, { status: 400 });
  }

  // Live membership check — never trust the client's requested familyId.
  const membership = await getMembership(session.userId, target);
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of that family' }, { status: 403 });
  }

  session.familyId = target;
  session.role = membership.role;
  // The joined/active person mapping is per-family — clear the stale one from
  // whatever family was previously active (same discipline as the /join route).
  delete session.personId;
  // Exit combined/merged view mode when switching to a single family.
  delete session.viewFamilyIds;
  await session.save();

  // 303 See Other: forces the browser to GET / after this POST, rather than
  // resubmitting the form on refresh.
  return NextResponse.redirect(absoluteUrl('/', request), { status: 303 });
}
