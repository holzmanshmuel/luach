import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  // Destroy clears every field (userId, familyId, role, personId, …), so the next
  // request is fully signed out and the guards re-establish nothing from a stale cookie.
  session.destroy();
  await session.save();
  return NextResponse.redirect(new URL('/login', process.env.NEXTAUTH_URL ?? 'http://localhost:3000'));
}
