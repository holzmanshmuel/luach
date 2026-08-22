import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/absolute-url';

// Legacy magic-link deep-links were retired at the multi-family cutover:
// resolveToken()/markTokenUsed() are tenant-scoped queries with no tenant
// context available here, so this route would 500 for anyone hitting a
// printed QR card. Printed cards physically exist and must not 404, so the
// route stays — it just tombstones to a redirect. Signed-out scans land on
// /login via the proxy (see src/proxy.ts); signed-in scans land on the
// calendar. Revive properly via a SECURITY DEFINER token resolve if wanted
// (post-launch).
export async function GET(request: NextRequest) {
  return NextResponse.redirect(absoluteUrl('/', request));
}
