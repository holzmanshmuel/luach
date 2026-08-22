import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { filterToMemberships } from '@/lib/combined';
import { absoluteUrl } from '@/lib/absolute-url';

/**
 * Multi-select family view (combined view). Zero-JS <form method="post"> target.
 * The submitted familyId list is UNTRUSTED — validated live against memberships,
 * mirroring /api/family/switch. 1 valid ⇒ acts as a single switch; ≥2 ⇒ combined.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(absoluteUrl('/login', request), { status: 303 });
  }
  const form = await request.formData();
  const candidateIds = form.getAll('familyId')
    .map(v => (typeof v === 'string' ? Number(v) : NaN))
    .filter(n => Number.isInteger(n) && n > 0);

  const memberships = await getMembershipsForUser(session.userId);
  const valid = filterToMemberships(candidateIds, memberships);

  if (valid.length === 0) {
    return NextResponse.redirect(absoluteUrl('/', request), { status: 303 });
  }
  if (valid.length === 1) {
    session.familyId = valid[0];
    session.role = memberships.find(m => m.family_id === valid[0])!.role;
    delete session.viewFamilyIds;
    delete session.personId;
  } else {
    session.viewFamilyIds = valid;
  }
  await session.save();
  return NextResponse.redirect(absoluteUrl('/', request), { status: 303 });
}
